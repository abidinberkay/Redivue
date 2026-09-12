package com.redivue.service;

import com.redivue.config.RedisConnectionHolder;
import com.redivue.config.RedisURIHelper;
import com.redivue.model.*;
import io.lettuce.core.KeyScanCursor;
import io.lettuce.core.KeyValue;
import io.lettuce.core.Limit;
import io.lettuce.core.LettuceFutures;
import io.lettuce.core.Range;
import io.lettuce.core.RedisFuture;
import io.lettuce.core.RestoreArgs;
import io.lettuce.core.ScanArgs;
import io.lettuce.core.ScanCursor;
import io.lettuce.core.ScoredValue;
import io.lettuce.core.StreamMessage;
import io.lettuce.core.XAddArgs;
import io.lettuce.core.api.async.RedisAsyncCommands;
import io.lettuce.core.api.sync.RedisCommands;
import io.lettuce.core.codec.StringCodec;
import io.lettuce.core.output.CommandOutput;
import io.lettuce.core.output.IntegerOutput;
import io.lettuce.core.output.StatusOutput;
import io.lettuce.core.output.ValueListOutput;
import io.lettuce.core.output.ValueOutput;
import io.lettuce.core.protocol.CommandArgs;
import io.lettuce.core.protocol.ProtocolKeyword;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

@Service
@Slf4j
public class RedisService {

    @Autowired(required = false)
    private SshTunnelPool sshTunnelPool;

    /** Resolve SSH tunnel then connect — use this instead of RedisURIHelper.connect() directly. */
    private RedisConnectionHolder connect(RedisConnection conn) {
        return RedisURIHelper.connect(sshTunnelPool != null ? sshTunnelPool.resolve(conn) : conn);
    }

    public RedisStats getStats(RedisConnection connection) {
        try (RedisConnectionHolder h = connect(connection)) {
            RedisCommands<String, String> commands = h.sync();

            Map<String, String> info = parseInfo(commands.info("all"));

            long totalKeys = 0;
            try {
                String dbSize = commands.dbsize().toString();
                totalKeys = Long.parseLong(dbSize);
            } catch (Exception e) {
                log.warn("Could not get dbsize", e);
            }

            long hits = parseLong(info.getOrDefault("keyspace_hits", "0"));
            long misses = parseLong(info.getOrDefault("keyspace_misses", "0"));
            String hitRate = (hits + misses) > 0
                    ? String.format("%.1f%%", (hits * 100.0) / (hits + misses))
                    : "N/A";

            long uptimeSecs = parseLong(info.getOrDefault("uptime_in_seconds", "0"));
            String uptimeFormatted = formatUptime(uptimeSecs);

            String maxMemRaw = info.getOrDefault("maxmemory", "0");
            String maxMem = "0".equals(maxMemRaw) ? "unlimited" : info.getOrDefault("maxmemory_human", "N/A");

            return RedisStats.builder()
                    .memoryUsed(info.getOrDefault("used_memory_human", "N/A"))
                    .totalKeys(totalKeys)
                    .connectedClients(parseLong(info.getOrDefault("connected_clients", "0")))
                    .uptime(uptimeFormatted)
                    .redisVersion(info.getOrDefault("redis_version", "N/A"))
                    .role(info.getOrDefault("role", "N/A"))
                    .usedMemoryPeak(info.getOrDefault("used_memory_peak_human", "N/A"))
                    .maxMemory(maxMem)
                    .memFragmentationRatio(info.getOrDefault("mem_fragmentation_ratio", "N/A"))
                    .opsPerSec(parseLong(info.getOrDefault("instantaneous_ops_per_sec", "0")))
                    .hitRate(hitRate)
                    .totalCommandsProcessed(parseLong(info.getOrDefault("total_commands_processed", "0")))
                    .totalConnectionsReceived(parseLong(info.getOrDefault("total_connections_received", "0")))
                    .rdbLastBgsaveStatus(info.getOrDefault("rdb_last_bgsave_status", "N/A"))
                    .aofEnabled("1".equals(info.getOrDefault("aof_enabled", "0")))
                    .build();

        } catch (Exception e) {
            log.error("Error connecting to Redis", e);
            throw new RuntimeException("Failed to connect to Redis: " + e.getMessage());
        }
    }

    public KeyScanResult scanKeys(KeyScanRequest request) {
        try (RedisConnectionHolder h = connect(request)) {
            RedisCommands<String, String> commands = h.sync();

            String pattern = (request.getPattern() == null || request.getPattern().isBlank()) ? "*" : request.getPattern();
            boolean isWildcard = "*".equals(pattern);

            List<String> matchedKeys;
            String nextCursor;
            boolean done;

            if (isWildcard && !h.isCluster()) {
                // Paginated scan for wildcard — caller uses Load More (standalone only;
                // cluster scan cursors are compound objects that can't be serialized to a
                // string and passed back across requests)
                ScanArgs args = ScanArgs.Builder.matches(pattern)
                        .limit(request.getCount() > 0 ? request.getCount() : 100);
                ScanCursor sc = "0".equals(request.getCursor()) ? ScanCursor.INITIAL
                        : ScanCursor.of(request.getCursor());
                KeyScanCursor<String> cursor = commands.scan(sc, args);
                matchedKeys = cursor.getKeys();
                nextCursor = cursor.getCursor();
                done = cursor.isFinished();
            } else {
                // Full scan: specific patterns always, cluster wildcard always
                ScanArgs args = ScanArgs.Builder.matches(pattern).limit(500);
                matchedKeys = new ArrayList<>();
                KeyScanCursor<String> cursor = commands.scan(ScanCursor.INITIAL, args);
                matchedKeys.addAll(cursor.getKeys());
                while (!cursor.isFinished() && matchedKeys.size() < 10000) {
                    cursor = commands.scan(cursor, args);
                    matchedKeys.addAll(cursor.getKeys());
                }
                nextCursor = "0";
                done = true;
            }

            List<KeyInfo> keyInfos = new ArrayList<>(matchedKeys.size());
            if (!matchedKeys.isEmpty()) {
                RedisAsyncCommands<String, String> async = h.async();
                List<RedisFuture<String>> typeFutures = new ArrayList<>(matchedKeys.size());
                List<RedisFuture<Long>> ttlFutures = new ArrayList<>(matchedKeys.size());
                List<RedisFuture<Long>> memFutures = new ArrayList<>(matchedKeys.size());
                h.setAutoFlushCommands(false);
                try {
                    for (String key : matchedKeys) {
                        typeFutures.add(async.type(key));
                        ttlFutures.add(async.ttl(key));
                        memFutures.add(async.memoryUsage(key));
                    }
                } finally {
                    h.flushCommands();
                    h.setAutoFlushCommands(true);
                }
                List<RedisFuture<?>> all = new ArrayList<>(typeFutures.size() + ttlFutures.size() + memFutures.size());
                all.addAll(typeFutures);
                all.addAll(ttlFutures);
                all.addAll(memFutures);
                LettuceFutures.awaitAll(10, java.util.concurrent.TimeUnit.SECONDS, all.toArray(new RedisFuture[0]));
                for (int i = 0; i < matchedKeys.size(); i++) {
                    Long mem = null;
                    try { mem = memFutures.get(i).get(); } catch (Exception ignored) {}
                    String rawType = typeFutures.get(i).get();
                    keyInfos.add(KeyInfo.builder()
                        .key(matchedKeys.get(i))
                        .type("ReJSON-RL".equals(rawType) ? "json" : rawType)
                        .ttl(ttlFutures.get(i).get())
                        .memoryBytes(mem)
                        .build());
                }
            }

            return KeyScanResult.builder()
                    .nextCursor(nextCursor)
                    .keys(keyInfos)
                    .done(done)
                    .build();
        } catch (Exception e) {
            log.error("Error scanning keys", e);
            throw new RuntimeException("Failed to scan keys: " + e.getMessage());
        }
    }

    // Writes a RedisJSON document. Value is dispatched as a single raw arg (not run through
    // the CLI text tokenizer) so arbitrary JSON — nested quotes, spaces, unicode — survives intact.
    public void setJson(JsonSetRequest request) {
        try (RedisConnectionHolder h = connect(request)) {
            RedisCommands<String, String> commands = h.sync();
            String path = (request.getPath() == null || request.getPath().isBlank()) ? "$" : request.getPath();
            String status = dispatchRaw(commands, "JSON.SET", new StatusOutput<>(StringCodec.UTF8),
                    request.getKey(), path, request.getValue());
            if (status == null) throw new RuntimeException("JSON.SET failed — check module is loaded and JSON is valid");
        } catch (Exception e) {
            log.error("Error setting JSON key", e);
            throw new RuntimeException("Failed to set JSON: " + e.getMessage());
        }
    }

    public KeyValueResult getKeyValue(KeyValueRequest request) {
        try (RedisConnectionHolder h = connect(request)) {
            RedisCommands<String, String> commands = h.sync();

            String key = request.getKey();
            // RedisJSON module keys report TYPE "ReJSON-RL" — normalize to "json" so the
            // frontend's type-based routing (badge color, editor) matches
            String rawType = commands.type(key);
            String type = "ReJSON-RL".equals(rawType) ? "json" : rawType;
            long ttl = commands.ttl(key);
            Object value;

            switch (type) {
                case "string" -> value = commands.get(key);
                case "hash" -> value = commands.hgetall(key);
                case "list" -> value = commands.lrange(key, 0, -1);
                case "set" -> value = commands.smembers(key);
                case "zset" -> {
                    List<ScoredValue<String>> scored = commands.zrangeWithScores(key, 0, -1);
                    List<Map<String, Object>> zsetValue = new ArrayList<>();
                    for (ScoredValue<String> sv : scored) {
                        Map<String, Object> entry = new HashMap<>();
                        entry.put("member", sv.getValue());
                        entry.put("score", sv.getScore());
                        zsetValue.add(entry);
                    }
                    value = zsetValue;
                }
                case "stream" -> {
                    List<StreamMessage<String, String>> msgs = commands.xrange(key, Range.unbounded(), Limit.create(0, 500));
                    List<Map<String, Object>> streamValue = new ArrayList<>();
                    for (StreamMessage<String, String> msg : msgs) {
                        Map<String, Object> entry = new LinkedHashMap<>();
                        entry.put("id", msg.getId());
                        entry.put("fields", msg.getBody());
                        streamValue.add(entry);
                    }
                    value = streamValue;
                }
                case "json" -> {
                    try {
                        value = dispatchRaw(commands, "JSON.GET", new ValueOutput<>(StringCodec.UTF8), key);
                    } catch (Exception e) {
                        log.warn("JSON.GET failed for key {}", key, e);
                        value = null;
                    }
                }
                default -> value = null;
            }

            Long memoryBytes = null;
            try { memoryBytes = commands.memoryUsage(key); } catch (Exception ignored) {}

            String encoding = null;
            try { encoding = commands.objectEncoding(key); } catch (Exception ignored) {}

            Long elementCount = null;
            try {
                elementCount = switch (type) {
                    case "string" -> commands.strlen(key);
                    case "hash" -> commands.hlen(key);
                    case "list" -> commands.llen(key);
                    case "set" -> commands.scard(key);
                    case "zset" -> commands.zcard(key);
                    case "stream" -> commands.xlen(key);
                    default -> null;
                };
            } catch (Exception ignored) {}

            return KeyValueResult.builder()
                    .key(key).type(type).value(value).ttl(ttl)
                    .memoryBytes(memoryBytes).encoding(encoding).elementCount(elementCount)
                    .build();
        } catch (Exception e) {
            log.error("Error getting key value", e);
            throw new RuntimeException("Failed to get key value: " + e.getMessage());
        }
    }

    public DiffResult getDiff(DiffRequest request) {
        KeyValueRequest leftReq = new KeyValueRequest();
        leftReq.setHost(request.getLeft().getHost());
        leftReq.setPort(request.getLeft().getPort());
        leftReq.setPassword(request.getLeft().getPassword());
        leftReq.setDb(request.getLeft().getDb());
        leftReq.setKey(request.getKey());

        KeyValueRequest rightReq = new KeyValueRequest();
        rightReq.setHost(request.getRight().getHost());
        rightReq.setPort(request.getRight().getPort());
        rightReq.setPassword(request.getRight().getPassword());
        rightReq.setDb(request.getRight().getDb());
        rightReq.setKey(request.getKey());

        KeyValueResult leftResult = null;
        String leftError = null;
        KeyValueResult rightResult = null;
        String rightError = null;

        try {
            leftResult = getKeyValue(leftReq);
            if ("none".equals(leftResult.getType())) {
                leftError = "Key not found";
                leftResult = null;
            }
        } catch (Exception e) {
            leftError = e.getMessage();
        }

        try {
            rightResult = getKeyValue(rightReq);
            if ("none".equals(rightResult.getType())) {
                rightError = "Key not found";
                rightResult = null;
            }
        } catch (Exception e) {
            rightError = e.getMessage();
        }

        return DiffResult.builder()
                .left(leftResult)
                .right(rightResult)
                .leftError(leftError)
                .rightError(rightError)
                .build();
    }

    public void configSet(ConfigSetRequest request) {
        try (RedisConnectionHolder h = connect(request)) {
            h.sync().configSet(request.getParam(), request.getValue());
        } catch (Exception e) {
            log.error("Error setting config", e);
            throw new RuntimeException("Failed to set config: " + e.getMessage());
        }
    }

    public Map<String, String> configGet(RedisConnection request) {
        try (RedisConnectionHolder h = connect(request)) {
            return h.sync().configGet("*");
        } catch (Exception e) {
            log.error("Error getting config", e);
            throw new RuntimeException("Failed to get config: " + e.getMessage());
        }
    }

    public void renameKey(KeyRenameRequest request) {
        try (RedisConnectionHolder h = connect(request)) {
            h.sync().rename(request.getKey(), request.getNewKey());
        } catch (Exception e) {
            log.error("Error renaming key", e);
            throw new RuntimeException("Failed to rename key: " + e.getMessage());
        }
    }

    public boolean deleteKey(KeyDeleteRequest request) {
        try (RedisConnectionHolder h = connect(request)) {
            RedisCommands<String, String> commands = h.sync();
            long deleted = commands.del(request.getKey());
            return deleted > 0;
        } catch (Exception e) {
            log.error("Error deleting key", e);
            throw new RuntimeException("Failed to delete key: " + e.getMessage());
        }
    }

    public void setString(StringSetRequest request) {
        try (RedisConnectionHolder h = connect(request)) {
            RedisCommands<String, String> commands = h.sync();
            commands.set(request.getKey(), request.getValue());
            if (request.getTtl() > 0) {
                commands.expire(request.getKey(), request.getTtl());
            }
        } catch (Exception e) {
            log.error("Error setting string", e);
            throw new RuntimeException("Failed to set string: " + e.getMessage());
        }
    }

    public void setTtl(TtlRequest request) {
        try (RedisConnectionHolder h = connect(request)) {
            RedisCommands<String, String> commands = h.sync();
            if (request.getTtl() == -1) {
                commands.persist(request.getKey());
            } else {
                commands.expire(request.getKey(), request.getTtl());
            }
        } catch (Exception e) {
            log.error("Error setting TTL", e);
            throw new RuntimeException("Failed to set TTL: " + e.getMessage());
        }
    }

    public void hashFieldOp(HashFieldRequest request) {
        try (RedisConnectionHolder h = connect(request)) {
            RedisCommands<String, String> commands = h.sync();
            switch (request.getOperation()) {
                case "set" -> commands.hset(request.getKey(), request.getField(), request.getValue());
                case "delete" -> commands.hdel(request.getKey(), request.getField());
                default -> throw new IllegalArgumentException("Unknown operation: " + request.getOperation());
            }
        } catch (Exception e) {
            log.error("Error hash field operation", e);
            throw new RuntimeException("Failed hash field operation: " + e.getMessage());
        }
    }

    public void listOp(ListOpRequest request) {
        try (RedisConnectionHolder h = connect(request)) {
            RedisCommands<String, String> commands = h.sync();
            switch (request.getOperation()) {
                case "lpush" -> commands.lpush(request.getKey(), request.getValue());
                case "rpush" -> commands.rpush(request.getKey(), request.getValue());
                case "lrem" -> commands.lrem(request.getKey(), 1, request.getValue());
                case "lset" -> commands.lset(request.getKey(), request.getIndex(), request.getValue());
                default -> throw new IllegalArgumentException("Unknown operation: " + request.getOperation());
            }
        } catch (Exception e) {
            log.error("Error list operation", e);
            throw new RuntimeException("Failed list operation: " + e.getMessage());
        }
    }

    public void setOp(SetOpRequest request) {
        try (RedisConnectionHolder h = connect(request)) {
            RedisCommands<String, String> commands = h.sync();
            switch (request.getOperation()) {
                case "add" -> commands.sadd(request.getKey(), request.getValue());
                case "remove" -> commands.srem(request.getKey(), request.getValue());
                default -> throw new IllegalArgumentException("Unknown operation: " + request.getOperation());
            }
        } catch (Exception e) {
            log.error("Error set operation", e);
            throw new RuntimeException("Failed set operation: " + e.getMessage());
        }
    }

    public void zsetOp(ZSetOpRequest request) {
        try (RedisConnectionHolder h = connect(request)) {
            RedisCommands<String, String> commands = h.sync();
            switch (request.getOperation()) {
                case "add" -> commands.zadd(request.getKey(), request.getScore(), request.getMember());
                case "remove" -> commands.zrem(request.getKey(), request.getMember());
                default -> throw new IllegalArgumentException("Unknown operation: " + request.getOperation());
            }
        } catch (Exception e) {
            log.error("Error zset operation", e);
            throw new RuntimeException("Failed zset operation: " + e.getMessage());
        }
    }

    public Map<String, Object> copyKey(CopyKeyRequest request) {
        try (RedisConnectionHolder src = connect(request);
             RedisConnectionHolder dst = connectTarget(request)) {
            RedisCommands<String, String> srcCmd = src.sync();
            RedisCommands<String, String> dstCmd = dst.sync();

            String type = srcCmd.type(request.getKey());
            if ("none".equals(type)) {
                throw new RuntimeException("Key not found: " + request.getKey());
            }
            long ttl = srcCmd.ttl(request.getKey());

            String status = copyOne(src, dst, request.getKey(), type, ttl, request.isReplace());
            String normType = "ReJSON-RL".equals(type) ? "json" : type;
            return Map.of("key", request.getKey(), "type", normType, "status", status);
        } catch (Exception e) {
            throw new RuntimeException(e.getMessage(), e);
        }
    }

    // Copies a single key between two already-open connections. Returns "ok" or "skipped".
    private String copyOne(RedisConnectionHolder srcHolder, RedisConnectionHolder dstHolder,
                           String key, String type, long ttl, boolean replace) {
        RedisCommands<String, String> src = srcHolder.sync();
        RedisCommands<String, String> dst = dstHolder.sync();
        if (!replace) {
            String existingType = dst.type(key);
            if (!"none".equals(existingType)) {
                return "skipped";
            }
        } else {
            dst.del(key);
        }

        switch (type) {
            case "string" -> {
                String val = src.get(key);
                dst.set(key, val);
            }
            case "hash" -> {
                Map<String, String> hash = src.hgetall(key);
                if (!hash.isEmpty()) dst.hset(key, hash);
            }
            case "list" -> {
                List<String> list = src.lrange(key, 0, -1);
                if (!list.isEmpty()) dst.rpush(key, list.toArray(new String[0]));
            }
            case "set" -> {
                Set<String> members = src.smembers(key);
                if (!members.isEmpty()) dst.sadd(key, members.toArray(new String[0]));
            }
            case "zset" -> {
                List<ScoredValue<String>> scored = src.zrangeWithScores(key, 0, -1);
                if (!scored.isEmpty()) dst.zadd(key, scored.toArray(new ScoredValue[0]));
            }
            case "stream" -> {
                List<StreamMessage<String, String>> msgs = src.xrange(key, Range.unbounded());
                for (StreamMessage<String, String> msg : msgs) {
                    dst.xadd(key, new XAddArgs().id(msg.getId()), msg.getBody());
                }
            }
            // JSON (ReJSON-RL) and any other module type — exact binary copy.
            default -> {
                dumpRestore(srcHolder, dstHolder, key, ttl);
                return "ok";
            }
        }

        if (ttl > 0) {
            dst.expire(key, ttl);
        }
        return "ok";
    }

    // Type-agnostic exact copy via DUMP + RESTORE. Preserves the on-the-wire
    // encoding and works for every type/module (JSON, Streams, …). The caller has
    // already cleared the target on replace, and returned "skipped" otherwise, so
    // RESTORE always runs with REPLACE.
    private void dumpRestore(RedisConnectionHolder srcHolder, RedisConnectionHolder dstHolder,
                             String key, long ttlSeconds) {
        byte[] k = key.getBytes(StandardCharsets.UTF_8);
        byte[] payload = srcHolder.binarySync().dump(k);
        if (payload == null) throw new RuntimeException("Key not found: " + key);
        long ttlMillis = ttlSeconds > 0 ? ttlSeconds * 1000L : 0L;
        try {
            dstHolder.binarySync().restore(k, payload, RestoreArgs.Builder.ttl(ttlMillis).replace(true));
        } catch (Exception e) {
            throw new RuntimeException("RESTORE failed for \"" + key + "\" — the target Redis is"
                    + " older than the source or is missing the module that owns this key (e.g. RedisJSON): "
                    + e.getMessage());
        }
    }

    /* ===== Batch / bulk operations (single connection, variadic + pipelined) ===== */

    // Deletes many keys in one shot using variadic UNLINK (non-blocking, frees memory in background).
    public long deleteKeysBatch(KeyBatchRequest request) {
        List<String> keys = request.getKeys();
        if (keys == null || keys.isEmpty()) return 0;
        try (RedisConnectionHolder h = connect(request)) {
            RedisCommands<String, String> commands = h.sync();
            long total = 0;
            int chunk = 1000;
            for (int i = 0; i < keys.size(); i += chunk) {
                List<String> sub = keys.subList(i, Math.min(i + chunk, keys.size()));
                total += commands.unlink(sub.toArray(new String[0]));
            }
            return total;
        } catch (Exception e) {
            log.error("Error in batch delete", e);
            throw new RuntimeException("Failed to delete keys: " + e.getMessage());
        }
    }

    // Deletes every key matching a pattern entirely on the server.
    // "*" uses FLUSHDB (instant); other patterns SCAN + chunked UNLINK.
    public Map<String, Object> deleteByPattern(PatternRequest request) {
        String pattern = (request.getPattern() == null || request.getPattern().isBlank()) ? "*" : request.getPattern();
        try (RedisConnectionHolder h = connect(request)) {
            RedisCommands<String, String> commands = h.sync();

            if ("*".equals(pattern)) {
                long count = commands.dbsize();
                commands.flushdb();
                return Map.of("deleted", count, "method", "FLUSHDB");
            }

            long deleted = 0;
            ScanArgs args = ScanArgs.Builder.matches(pattern).limit(1000);
            List<String> buffer = new ArrayList<>();
            KeyScanCursor<String> cursor = commands.scan(ScanCursor.INITIAL, args);
            while (true) {
                buffer.addAll(cursor.getKeys());
                if (buffer.size() >= 1000) {
                    deleted += commands.unlink(buffer.toArray(new String[0]));
                    buffer.clear();
                }
                if (cursor.isFinished()) break;
                cursor = commands.scan(cursor, args);
            }
            if (!buffer.isEmpty()) {
                deleted += commands.unlink(buffer.toArray(new String[0]));
            }
            return Map.of("deleted", deleted, "method", "SCAN+UNLINK");
        } catch (Exception e) {
            log.error("Error in pattern delete", e);
            throw new RuntimeException("Failed to delete by pattern: " + e.getMessage());
        }
    }

    // Applies one TTL (or -1 to persist) to many keys via a single pipelined round trip.
    public Map<String, Object> setTtlBatch(BatchTtlRequest request) {
        List<String> keys = request.getKeys();
        if (keys == null || keys.isEmpty()) return Map.of("updated", 0, "failed", 0);
        try (RedisConnectionHolder h = connect(request)) {
            RedisAsyncCommands<String, String> async = h.async();
            async.setAutoFlushCommands(false);

            List<RedisFuture<Boolean>> futures = new ArrayList<>();
            for (String key : keys) {
                futures.add(request.getTtl() == -1 ? async.persist(key) : async.expire(key, request.getTtl()));
            }
            async.flushCommands();
            LettuceFutures.awaitAll(60, TimeUnit.SECONDS, futures.toArray(new RedisFuture[0]));

            long updated = 0, failed = 0;
            for (RedisFuture<Boolean> f : futures) {
                try { f.get(); updated++; }
                catch (Exception e) { failed++; }
            }
            return Map.of("updated", updated, "failed", failed);
        } catch (Exception e) {
            log.error("Error in batch TTL", e);
            throw new RuntimeException("Failed to set TTL: " + e.getMessage());
        }
    }

    // Reads type+ttl+value for many keys using two pipelined passes (for export/backup).
    public List<Map<String, Object>> getValuesBatch(KeyBatchRequest request) {
        List<String> keys = request.getKeys();
        if (keys == null || keys.isEmpty()) return new ArrayList<>();
        try (RedisConnectionHolder h = connect(request)) {
            RedisAsyncCommands<String, String> async = h.async();
            async.setAutoFlushCommands(false);

            int n = keys.size();
            List<RedisFuture<String>> typeF = new ArrayList<>(n);
            List<RedisFuture<Long>> ttlF = new ArrayList<>(n);
            for (String key : keys) {
                typeF.add(async.type(key));
                ttlF.add(async.ttl(key));
            }
            async.flushCommands();
            List<RedisFuture<?>> phase1 = new ArrayList<>(typeF);
            phase1.addAll(ttlF);
            LettuceFutures.awaitAll(60, TimeUnit.SECONDS, phase1.toArray(new RedisFuture[0]));

            String[] types = new String[n];
            long[] ttls = new long[n];
            for (int i = 0; i < n; i++) {
                types[i] = safeGet(typeF.get(i), "none");
                ttls[i] = safeGet(ttlF.get(i), -2L);
            }

            // Phase 2: read the value with the right command per type
            RedisFuture<?>[] valF = new RedisFuture<?>[n];
            for (int i = 0; i < n; i++) {
                String key = keys.get(i);
                valF[i] = switch (types[i]) {
                    case "string" -> async.get(key);
                    case "hash" -> async.hgetall(key);
                    case "list" -> async.lrange(key, 0, -1);
                    case "set" -> async.smembers(key);
                    case "zset" -> async.zrangeWithScores(key, 0, -1);
                    default -> null;
                };
            }
            async.flushCommands();
            List<RedisFuture<?>> phase2 = new ArrayList<>();
            for (RedisFuture<?> f : valF) if (f != null) phase2.add(f);
            LettuceFutures.awaitAll(60, TimeUnit.SECONDS, phase2.toArray(new RedisFuture[0]));

            List<Map<String, Object>> results = new ArrayList<>(n);
            for (int i = 0; i < n; i++) {
                Map<String, Object> entry = new LinkedHashMap<>();
                entry.put("key", keys.get(i));
                entry.put("type", types[i]);
                entry.put("ttl", ttls[i]);
                entry.put("value", extractValue(types[i], valF[i]));
                results.add(entry);
            }
            return results;
        } catch (Exception e) {
            log.error("Error in batch values", e);
            throw new RuntimeException("Failed to read values: " + e.getMessage());
        }
    }

    @SuppressWarnings("unchecked")
    private Object extractValue(String type, RedisFuture<?> f) {
        if (f == null) return null;
        try {
            Object raw = f.get();
            if ("zset".equals(type)) {
                List<ScoredValue<String>> scored = (List<ScoredValue<String>>) raw;
                List<Map<String, Object>> zsetValue = new ArrayList<>();
                for (ScoredValue<String> sv : scored) {
                    Map<String, Object> e = new HashMap<>();
                    e.put("member", sv.getValue());
                    e.put("score", sv.getScore());
                    zsetValue.add(e);
                }
                return zsetValue;
            }
            return raw;
        } catch (Exception e) {
            return null;
        }
    }

    private <T> T safeGet(RedisFuture<T> f, T fallback) {
        try { return f.get(); } catch (Exception e) { return fallback; }
    }

    // Copies many keys to another connection over two persistent connections.
    public Map<String, Object> copyKeysBatch(BatchCopyRequest request) {
        List<String> keys = request.getKeys();
        List<String> succeeded = new ArrayList<>();
        List<String> skipped = new ArrayList<>();
        List<Map<String, Object>> failed = new ArrayList<>();
        if (keys == null || keys.isEmpty()) {
            return Map.of("succeeded", succeeded, "skipped", skipped, "failed", failed);
        }
        try (RedisConnectionHolder src = connect(request);
             RedisConnectionHolder dst = connectTarget(request)) {
            RedisCommands<String, String> srcCmd = src.sync();
            RedisCommands<String, String> dstCmd = dst.sync();

            for (String key : keys) {
                try {
                    String type = srcCmd.type(key);
                    if ("none".equals(type)) {
                        failed.add(Map.of("key", key, "error", "key not found"));
                        continue;
                    }
                    long ttl = srcCmd.ttl(key);
                    String status = copyOne(src, dst, key, type, ttl, request.isReplace());
                    if ("skipped".equals(status)) skipped.add(key);
                    else succeeded.add(key);
                } catch (Exception e) {
                    failed.add(Map.of("key", key, "error", e.getMessage() != null ? e.getMessage() : "failed"));
                }
            }
            return Map.of("succeeded", succeeded, "skipped", skipped, "failed", failed);
        } catch (Exception e) {
            log.error("Error in batch copy", e);
            throw new RuntimeException("Failed to copy keys: " + e.getMessage());
        }
    }

    // Scans all keys matching a pattern in one server-side loop, enriched with type+ttl (pipelined).
    public KeyScanResult scanAll(PatternRequest request) {
        String pattern = (request.getPattern() == null || request.getPattern().isBlank()) ? "*" : request.getPattern();
        try (RedisConnectionHolder h = connect(request)) {
            RedisCommands<String, String> commands = h.sync();

            List<String> matched = new ArrayList<>();
            ScanArgs args = ScanArgs.Builder.matches(pattern).limit(1000);
            KeyScanCursor<String> cursor = commands.scan(ScanCursor.INITIAL, args);
            while (true) {
                matched.addAll(cursor.getKeys());
                if (cursor.isFinished() || matched.size() >= 200000) break;
                cursor = commands.scan(cursor, args);
            }

            // Enrich with type + ttl via a single pipelined pass
            RedisAsyncCommands<String, String> async = h.async();
            async.setAutoFlushCommands(false);
            int n = matched.size();
            List<RedisFuture<String>> typeF = new ArrayList<>(n);
            List<RedisFuture<Long>> ttlF = new ArrayList<>(n);
            for (String key : matched) {
                typeF.add(async.type(key));
                ttlF.add(async.ttl(key));
            }
            async.flushCommands();
            List<RedisFuture<?>> all = new ArrayList<>(typeF);
            all.addAll(ttlF);
            LettuceFutures.awaitAll(60, TimeUnit.SECONDS, all.toArray(new RedisFuture[0]));

            List<KeyInfo> keyInfos = new ArrayList<>(n);
            for (int i = 0; i < n; i++) {
                String rawType = safeGet(typeF.get(i), "none");
                keyInfos.add(KeyInfo.builder()
                        .key(matched.get(i))
                        .type("ReJSON-RL".equals(rawType) ? "json" : rawType)
                        .ttl(safeGet(ttlF.get(i), -2L))
                        .build());
            }

            return KeyScanResult.builder().nextCursor("0").keys(keyInfos).done(true).build();
        } catch (Exception e) {
            log.error("Error in scan-all", e);
            throw new RuntimeException("Failed to scan keys: " + e.getMessage());
        }
    }

    private static final String EXPORT_DIR = System.getProperty("java.io.tmpdir") + File.separator + "redivue-exports";
    private static final java.util.regex.Pattern UUID_PATTERN = java.util.regex.Pattern.compile(
            "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$");

    // fileId always originates from our own UUID.randomUUID() in exportToDisk(), but every other
    // call site takes it back from the client (path variable or request body) — reject anything
    // that isn't a bare UUID before it reaches Paths.get(), or "../../etc/whatever" would let a
    // caller read/delete/import arbitrary *.json files outside EXPORT_DIR.
    private Path resolveExportPath(String fileId) {
        if (fileId == null || !UUID_PATTERN.matcher(fileId).matches()) {
            throw new RuntimeException("Invalid export file id");
        }
        return Paths.get(EXPORT_DIR, fileId + ".json");
    }

    public Map<String, Object> exportToDisk(DiskExportRequest request) {
        String pattern = (request.getPattern() == null || request.getPattern().isBlank()) ? "*" : request.getPattern();
        try (RedisConnectionHolder h = connect(request)) {
            Files.createDirectories(Paths.get(EXPORT_DIR));

            RedisCommands<String, String> commands = h.sync();

            List<String> matched = new ArrayList<>();
            ScanArgs args = ScanArgs.Builder.matches(pattern).limit(1000);
            KeyScanCursor<String> cursor = commands.scan(ScanCursor.INITIAL, args);
            while (true) {
                matched.addAll(cursor.getKeys());
                if (cursor.isFinished()) break;
                cursor = commands.scan(cursor, args);
            }

            List<Map<String, Object>> keys = new ArrayList<>(matched.size());
            for (String key : matched) {
                String type = commands.type(key);
                if ("none".equals(type)) continue;
                long ttl = commands.ttl(key);
                Object value = readValue(h, key, type);
                Map<String, Object> entry = new LinkedHashMap<>();
                entry.put("key", key);
                entry.put("type", "ReJSON-RL".equals(type) ? "json" : type);
                entry.put("ttl", ttl);
                entry.put("value", value);
                keys.add(entry);
            }

            String fileId = UUID.randomUUID().toString();
            Map<String, Object> snapshot = new LinkedHashMap<>();
            snapshot.put("exportedAt", Instant.now().toString());
            snapshot.put("source", request.getHost() + ":" + request.getPort() + " DB " + request.getDb());
            snapshot.put("pattern", pattern);
            snapshot.put("keyCount", keys.size());
            snapshot.put("keys", keys);

            Path filePath = Paths.get(EXPORT_DIR, fileId + ".json");
            new ObjectMapper().writeValue(filePath.toFile(), snapshot);
            long fileSize = Files.size(filePath);

            return Map.of("fileId", fileId, "keyCount", keys.size(), "fileSize", fileSize,
                    "source", snapshot.get("source"), "pattern", pattern);
        } catch (Exception e) {
            log.error("Error in disk export", e);
            throw new RuntimeException("Failed to export: " + e.getMessage());
        }
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> importFromDisk(DiskImportRequest request) {
        List<String> succeeded = new ArrayList<>();
        List<String> skipped = new ArrayList<>();
        List<Map<String, Object>> failed = new ArrayList<>();
        try (RedisConnectionHolder dst = connectTarget(request)) {
            Path filePath = resolveExportPath(request.getFileId());
            if (!Files.exists(filePath)) throw new RuntimeException("Export file not found: " + request.getFileId());

            Map<String, Object> snapshot = new ObjectMapper().readValue(filePath.toFile(), Map.class);
            List<Map<String, Object>> keys = (List<Map<String, Object>>) snapshot.get("keys");

            RedisCommands<String, String> dstCmd = dst.sync();

            for (Map<String, Object> entry : keys) {
                String key = (String) entry.get("key");
                String type = (String) entry.get("type");
                long ttl = ((Number) entry.get("ttl")).longValue();
                try {
                    if (!request.isReplace() && !"none".equals(dstCmd.type(key))) {
                        skipped.add(key);
                        continue;
                    }
                    dstCmd.del(key);
                    writeValue(dst, key, type, entry.get("value"));
                    if (ttl > 0) dstCmd.expire(key, ttl);
                    succeeded.add(key);
                } catch (Exception e) {
                    failed.add(Map.of("key", key, "error", e.getMessage() != null ? e.getMessage() : "failed"));
                }
            }
            return Map.of("succeeded", succeeded.size(), "skipped", skipped, "failed", failed);
        } catch (Exception e) {
            log.error("Error in disk import", e);
            throw new RuntimeException("Failed to import: " + e.getMessage());
        }
    }

    public byte[] downloadExport(String fileId) {
        try {
            Path filePath = resolveExportPath(fileId);
            if (!Files.exists(filePath)) throw new RuntimeException("Export file not found");
            return Files.readAllBytes(filePath);
        } catch (Exception e) {
            throw new RuntimeException("Failed to download: " + e.getMessage());
        }
    }

    public List<Map<String, Object>> listExports() {
        try {
            Files.createDirectories(Paths.get(EXPORT_DIR));
            File dir = new File(EXPORT_DIR);
            List<Map<String, Object>> exports = new ArrayList<>();

            File[] files = dir.listFiles((d, n) -> n.endsWith(".json"));
            if (files != null) {
                for (File f : files) {
                    try {
                        Map<String, Object> snapshot = new ObjectMapper().readValue(f, Map.class);
                        Map<String, Object> entry = new LinkedHashMap<>();
                        entry.put("fileId", f.getName().replace(".json", ""));
                        entry.put("exportedAt", snapshot.getOrDefault("exportedAt", "unknown"));
                        entry.put("source", snapshot.getOrDefault("source", "unknown"));
                        entry.put("pattern", snapshot.getOrDefault("pattern", "*"));
                        entry.put("keyCount", snapshot.getOrDefault("keyCount", 0));
                        entry.put("fileSize", f.length());
                        exports.add(entry);
                    } catch (Exception e) {
                        log.warn("Failed to read export file: " + f.getName(), e);
                    }
                }
            }
            exports.sort((a, b) -> ((String) b.get("exportedAt")).compareTo((String) a.get("exportedAt")));
            return exports;
        } catch (Exception e) {
            throw new RuntimeException("Failed to list exports: " + e.getMessage());
        }
    }

    public void deleteExport(String fileId) {
        try {
            Path filePath = resolveExportPath(fileId);
            if (!Files.exists(filePath)) throw new RuntimeException("Export file not found");
            Files.delete(filePath);
        } catch (Exception e) {
            throw new RuntimeException("Failed to delete: " + e.getMessage());
        }
    }

    // Marker key used to carry a base64 DUMP payload through the JSON export file
    // for types with no field-level representation (JSON / future modules).
    private static final String DUMP_MARKER = "__dump_b64__";

    private Object readValue(RedisConnectionHolder h, String key, String type) {
        RedisCommands<String, String> commands = h.sync();
        return switch (type) {
            case "string" -> commands.get(key);
            case "hash"   -> commands.hgetall(key);
            case "list"   -> commands.lrange(key, 0, -1);
            case "set"    -> commands.smembers(key);
            case "zset"   -> {
                List<Map<String, Object>> zset = new ArrayList<>();
                for (ScoredValue<String> sv : commands.zrangeWithScores(key, 0, -1)) {
                    Map<String, Object> e = new LinkedHashMap<>();
                    e.put("member", sv.getValue());
                    e.put("score", sv.getScore());
                    zset.add(e);
                }
                yield zset;
            }
            case "stream" -> {
                List<Map<String, Object>> entries = new ArrayList<>();
                for (StreamMessage<String, String> msg : commands.xrange(key, Range.unbounded())) {
                    Map<String, Object> e = new LinkedHashMap<>();
                    e.put("id", msg.getId());
                    e.put("fields", msg.getBody());
                    entries.add(e);
                }
                yield entries;
            }
            // JSON (ReJSON-RL) and any other module type — exact binary snapshot.
            default -> {
                byte[] payload = h.binarySync().dump(key.getBytes(StandardCharsets.UTF_8));
                if (payload == null) yield null;
                Map<String, Object> wrapper = new LinkedHashMap<>();
                wrapper.put(DUMP_MARKER, Base64.getEncoder().encodeToString(payload));
                yield wrapper;
            }
        };
    }

    @SuppressWarnings("unchecked")
    private void writeValue(RedisConnectionHolder h, String key, String type, Object value) {
        RedisCommands<String, String> dst = h.sync();
        // A DUMP-marker wrapper round-trips via RESTORE regardless of the declared type.
        if (value instanceof Map<?, ?> m && m.get(DUMP_MARKER) instanceof String b64) {
            byte[] payload = Base64.getDecoder().decode(b64);
            try {
                h.binarySync().restore(key.getBytes(StandardCharsets.UTF_8), payload,
                        RestoreArgs.Builder.ttl(0).replace(true));
            } catch (Exception e) {
                throw new RuntimeException("RESTORE failed for \"" + key + "\" — this Redis is older"
                        + " than the export source or is missing the module that owns this key (e.g. RedisJSON): "
                        + e.getMessage());
            }
            return;
        }
        switch (type) {
            case "string" -> dst.set(key, (String) value);
            case "hash" -> {
                Map<String, String> hash = (Map<String, String>) value;
                if (!hash.isEmpty()) dst.hset(key, hash);
            }
            case "list" -> {
                List<String> list = (List<String>) value;
                if (!list.isEmpty()) dst.rpush(key, list.toArray(new String[0]));
            }
            case "set" -> {
                List<String> members = (List<String>) value;
                if (!members.isEmpty()) dst.sadd(key, members.toArray(new String[0]));
            }
            case "zset" -> {
                List<Map<String, Object>> zset = (List<Map<String, Object>>) value;
                for (Map<String, Object> e : zset) {
                    dst.zadd(key, ((Number) e.get("score")).doubleValue(), (String) e.get("member"));
                }
            }
            case "stream" -> {
                List<Map<String, Object>> entries = (List<Map<String, Object>>) value;
                for (Map<String, Object> e : entries) {
                    Map<String, String> fields = (Map<String, String>) e.get("fields");
                    String id = (String) e.get("id");
                    if (fields != null && !fields.isEmpty()) {
                        dst.xadd(key, new XAddArgs().id(id), fields);
                    }
                }
            }
        }
    }

    // Scans matching keys and collects MEMORY USAGE + TYPE + TTL via a pipelined pass.
    // When the key count exceeds the request limit, returns a sampled subset.
    public Map<String, Object> analyzeMemory(MemoryAnalyzeRequest request) {
        String pattern = (request.getPattern() == null || request.getPattern().isBlank()) ? "*" : request.getPattern();
        int limit = request.getLimit() > 0 ? request.getLimit() : 10000;
        try (RedisConnectionHolder h = connect(request)) {
            RedisCommands<String, String> commands = h.sync();

            long totalKeyCount = commands.dbsize();

            List<String> matched = new ArrayList<>();
            ScanArgs args = ScanArgs.Builder.matches(pattern).limit(1000);
            KeyScanCursor<String> cursor = commands.scan(ScanCursor.INITIAL, args);
            while (true) {
                matched.addAll(cursor.getKeys());
                if (cursor.isFinished() || matched.size() >= limit) break;
                cursor = commands.scan(cursor, args);
            }

            // Trim to limit in case last SCAN batch pushed us slightly over
            if (matched.size() > limit) matched = matched.subList(0, limit);
            boolean sampled = !cursor.isFinished() || matched.size() < totalKeyCount;

            int n = matched.size();
            if (n == 0) {
                return Map.of("keys", List.of(), "totalScanned", 0, "totalBytes", 0L,
                        "byType", Map.of(), "sampled", false, "totalKeyCount", totalKeyCount);
            }

            RedisAsyncCommands<String, String> async = h.async();
            async.setAutoFlushCommands(false);

            List<RedisFuture<Long>> memF = new ArrayList<>(n);
            List<RedisFuture<String>> typeF = new ArrayList<>(n);
            List<RedisFuture<Long>> ttlF = new ArrayList<>(n);
            for (String key : matched) {
                memF.add(async.memoryUsage(key));
                typeF.add(async.type(key));
                ttlF.add(async.ttl(key));
            }
            async.flushCommands();

            List<RedisFuture<?>> all = new ArrayList<>(memF);
            all.addAll(typeF);
            all.addAll(ttlF);
            LettuceFutures.awaitAll(60, TimeUnit.SECONDS, all.toArray(new RedisFuture[0]));

            List<Map<String, Object>> entries = new ArrayList<>(n);
            Map<String, Long> byType = new HashMap<>();
            long totalBytes = 0L;

            for (int i = 0; i < n; i++) {
                long mem = safeGet(memF.get(i), 0L);
                String type = safeGet(typeF.get(i), "none");
                long ttl = safeGet(ttlF.get(i), -2L);

                Map<String, Object> entry = new LinkedHashMap<>();
                entry.put("key", matched.get(i));
                entry.put("type", type);
                entry.put("memoryBytes", mem);
                entry.put("ttl", ttl);
                entries.add(entry);

                byType.merge(type, mem, Long::sum);
                totalBytes += mem;
            }

            entries.sort((a, b) -> Long.compare((Long) b.get("memoryBytes"), (Long) a.get("memoryBytes")));

            Map<String, Object> result = new HashMap<>();
            result.put("keys", entries);
            result.put("totalScanned", n);
            result.put("totalBytes", totalBytes);
            result.put("byType", byType);
            result.put("sampled", sampled);
            result.put("totalKeyCount", totalKeyCount);
            return result;
        } catch (Exception e) {
            log.error("Error in memory analysis", e);
            throw new RuntimeException("Failed to analyze memory: " + e.getMessage());
        }
    }

    public String addStreamEntry(StreamAddRequest request) {
        try (RedisConnectionHolder h = connect(request)) {
            RedisCommands<String, String> commands = h.sync();
            Map<String, String> fields = request.getFields();
            if (fields == null || fields.isEmpty()) throw new RuntimeException("At least one field is required");
            String id = (request.getEntryId() == null || request.getEntryId().isBlank() || "*".equals(request.getEntryId()))
                    ? null : request.getEntryId();
            String newId = id != null
                    ? commands.xadd(request.getKey(), new XAddArgs().id(id), fields)
                    : commands.xadd(request.getKey(), fields);
            return newId;
        } catch (Exception e) {
            log.error("Error adding stream entry", e);
            throw new RuntimeException("Failed to add stream entry: " + e.getMessage());
        }
    }

    public long deleteStreamEntry(StreamEntryDeleteRequest request) {
        try (RedisConnectionHolder h = connect(request)) {
            return h.sync().xdel(request.getKey(), request.getEntryId());
        } catch (Exception e) {
            log.error("Error deleting stream entry", e);
            throw new RuntimeException("Failed to delete stream entry: " + e.getMessage());
        }
    }

    public Map<String, Object> getStreamGroups(KeyValueRequest request) {
        try (RedisConnectionHolder h = connect(request)) {
            RedisCommands<String, String> commands = h.sync();
            String key = request.getKey();
            List<Object> rawGroups = commands.xinfoGroups(key);
            List<Map<String, Object>> groups = new ArrayList<>();
            for (Object raw : rawGroups) {
                Map<String, Object> group = flattenXinfoObject(raw);
                String groupName = (String) group.getOrDefault("name", "");
                if (!groupName.isEmpty()) {
                    try {
                        List<Object> rawConsumers = commands.xinfoConsumers(key, groupName);
                        List<Map<String, Object>> consumers = new ArrayList<>();
                        for (Object rc : rawConsumers) consumers.add(flattenXinfoObject(rc));
                        group.put("consumers", consumers);
                    } catch (Exception ignored) {
                        group.put("consumers", List.of());
                    }
                }
                groups.add(group);
            }
            return Map.of("groups", groups, "length", commands.xlen(key));
        } catch (Exception e) {
            log.error("Error getting stream groups", e);
            throw new RuntimeException("Failed to get stream groups: " + e.getMessage());
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> flattenXinfoObject(Object raw) {
        Map<String, Object> result = new LinkedHashMap<>();
        if (raw instanceof List<?> list) {
            for (int i = 0; i + 1 < list.size(); i += 2) {
                result.put(String.valueOf(list.get(i)), list.get(i + 1));
            }
        } else if (raw instanceof Map) {
            result.putAll((Map<String, Object>) raw);
        }
        return result;
    }

    public CliResponse executeCommand(CliRequest request) {
        long start = System.currentTimeMillis();
        try (RedisConnectionHolder h = connect(request)) {
            RedisCommands<String, String> commands = h.sync();

            String[] tokens = tokenize(request.getCommand().trim());
            if (tokens.length == 0) {
                return CliResponse.builder().output("").executionTime(0L).build();
            }

            Object result = runCommand(commands, tokens);
            long elapsed = System.currentTimeMillis() - start;
            return CliResponse.builder()
                    .output(formatResult(result))
                    .executionTime(elapsed)
                    .build();
        } catch (IllegalArgumentException e) {
            return CliResponse.builder()
                    .error(e.getMessage())
                    .executionTime(System.currentTimeMillis() - start)
                    .build();
        } catch (Exception e) {
            log.error("CLI command failed", e);
            String msg = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
            return CliResponse.builder()
                    .error(msg)
                    .executionTime(System.currentTimeMillis() - start)
                    .build();
        }
    }

    public Map<String, Object> importCommands(BulkCommandImportRequest request) {
        List<String> commands = request.getCommands();
        if (commands == null || commands.isEmpty()) {
            return Map.of("total", 0, "succeeded", 0, "failed", List.of());
        }
        int succeeded = 0;
        List<Map<String, Object>> failed = new ArrayList<>();
        try (RedisConnectionHolder h = connect(request)) {
            RedisCommands<String, String> cmds = h.sync();
            for (String raw : commands) {
                String line = raw.trim();
                if (line.isEmpty() || line.startsWith("#")) continue;
                try {
                    String[] tokens = tokenize(line);
                    if (tokens.length == 0) continue;
                    runCommand(cmds, tokens);
                    succeeded++;
                } catch (Exception e) {
                    String msg = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
                    failed.add(Map.of("command", line, "error", msg));
                }
            }
        } catch (Exception e) {
            log.error("importCommands connection error", e);
            throw new RuntimeException("Failed to connect: " + e.getMessage());
        }
        return Map.of("total", commands.size(), "succeeded", succeeded, "failed", failed);
    }

    private Object runCommand(RedisCommands<String, String> commands, String[] t) {
        String cmd = t[0].toUpperCase();
        try {
            return switch (cmd) {
                // Connection
                case "PING"     -> t.length > 1 ? commands.ping() : commands.ping();
                case "ECHO"     -> { need(cmd, t, 2); yield t[1]; }
                case "SELECT"   -> { need(cmd, t, 2); yield commands.select(Integer.parseInt(t[1])); }
                // String
                case "GET"      -> { need(cmd, t, 2); yield commands.get(t[1]); }
                case "SET"      -> {
                    need(cmd, t, 3);
                    if (t.length >= 5 && t[3].equalsIgnoreCase("EX"))  yield commands.setex(t[1], Long.parseLong(t[4]), t[2]);
                    if (t.length >= 5 && t[3].equalsIgnoreCase("PX"))  yield commands.psetex(t[1], Long.parseLong(t[4]), t[2]);
                    yield commands.set(t[1], t[2]);
                }
                case "SETEX"    -> { need(cmd, t, 4); yield commands.setex(t[1], Long.parseLong(t[2]), t[3]); }
                case "PSETEX"   -> { need(cmd, t, 4); yield commands.psetex(t[1], Long.parseLong(t[2]), t[3]); }
                case "SETNX"    -> { need(cmd, t, 3); yield commands.setnx(t[1], t[2]); }
                case "GETSET"   -> { need(cmd, t, 3); yield commands.getset(t[1], t[2]); }
                case "GETDEL"   -> { need(cmd, t, 2); yield commands.getdel(t[1]); }
                case "APPEND"   -> { need(cmd, t, 3); yield commands.append(t[1], t[2]); }
                case "STRLEN"   -> { need(cmd, t, 2); yield commands.strlen(t[1]); }
                case "INCR"     -> { need(cmd, t, 2); yield commands.incr(t[1]); }
                case "INCRBY"   -> { need(cmd, t, 3); yield commands.incrby(t[1], Long.parseLong(t[2])); }
                case "INCRBYFLOAT" -> { need(cmd, t, 3); yield commands.incrbyfloat(t[1], Double.parseDouble(t[2])); }
                case "DECR"     -> { need(cmd, t, 2); yield commands.decr(t[1]); }
                case "DECRBY"   -> { need(cmd, t, 3); yield commands.decrby(t[1], Long.parseLong(t[2])); }
                case "MGET"     -> {
                    need(cmd, t, 2);
                    List<KeyValue<String, String>> kvs = commands.mget(Arrays.copyOfRange(t, 1, t.length));
                    yield kvs.stream().map(kv -> kv.hasValue() ? kv.getValue() : null).collect(Collectors.toList());
                }
                case "MSET"     -> {
                    if (t.length < 3 || (t.length - 1) % 2 != 0) throw new IllegalArgumentException("Usage: MSET key value [key value ...]");
                    Map<String, String> map = new LinkedHashMap<>();
                    for (int i = 1; i < t.length; i += 2) map.put(t[i], t[i + 1]);
                    yield commands.mset(map);
                }
                case "GETRANGE" -> { need(cmd, t, 4); yield commands.getrange(t[1], Long.parseLong(t[2]), Long.parseLong(t[3])); }
                case "SETRANGE" -> { need(cmd, t, 4); yield commands.setrange(t[1], Long.parseLong(t[2]), t[3]); }
                // Keys
                case "DEL"      -> { need(cmd, t, 2); yield commands.del(Arrays.copyOfRange(t, 1, t.length)); }
                case "UNLINK"   -> { need(cmd, t, 2); yield commands.unlink(Arrays.copyOfRange(t, 1, t.length)); }
                case "EXISTS"   -> { need(cmd, t, 2); yield commands.exists(Arrays.copyOfRange(t, 1, t.length)); }
                case "TYPE"     -> { need(cmd, t, 2); yield commands.type(t[1]); }
                case "TTL"      -> { need(cmd, t, 2); yield commands.ttl(t[1]); }
                case "PTTL"     -> { need(cmd, t, 2); yield commands.pttl(t[1]); }
                case "EXPIRE"   -> { need(cmd, t, 3); yield commands.expire(t[1], Long.parseLong(t[2])); }
                case "PEXPIRE"  -> { need(cmd, t, 3); yield commands.pexpire(t[1], Long.parseLong(t[2])); }
                case "EXPIREAT" -> { need(cmd, t, 3); yield commands.expireat(t[1], Long.parseLong(t[2])); }
                case "PERSIST"  -> { need(cmd, t, 2); yield commands.persist(t[1]); }
                case "RENAME"   -> { need(cmd, t, 3); yield commands.rename(t[1], t[2]); }
                case "RENAMENX" -> { need(cmd, t, 3); yield commands.renamenx(t[1], t[2]); }
                case "COPY"     -> { need(cmd, t, 3); yield commands.copy(t[1], t[2]); }
                case "MOVE"     -> { need(cmd, t, 3); yield commands.move(t[1], Integer.parseInt(t[2])); }
                case "KEYS"     -> { need(cmd, t, 2); yield commands.keys(t[1]); }
                case "RANDOMKEY"-> commands.randomkey();
                case "SCAN"     -> {
                    need(cmd, t, 2);
                    String pattern = "*"; long count = 100;
                    for (int i = 2; i < t.length - 1; i++) {
                        if (t[i].equalsIgnoreCase("MATCH"))       pattern = t[++i];
                        else if (t[i].equalsIgnoreCase("COUNT"))  count = Long.parseLong(t[++i]);
                    }
                    KeyScanCursor<String> sc = commands.scan(ScanCursor.of(t[1]), ScanArgs.Builder.matches(pattern).limit(count));
                    Map<String, Object> sr = new LinkedHashMap<>();
                    sr.put("cursor", sc.getCursor());
                    sr.put("keys", sc.getKeys());
                    yield sr;
                }
                case "DBSIZE"   -> commands.dbsize();
                case "FLUSHDB"  -> commands.flushdb();
                case "FLUSHALL" -> commands.flushall();
                case "BGSAVE"   -> commands.bgsave();
                case "INFO"     -> t.length > 1 ? commands.info(t[1]) : commands.info();
                case "ACL"      -> {
                    need(cmd, t, 2);
                    yield switch (t[1].toUpperCase()) {
                        case "WHOAMI" -> commands.aclWhoami();
                        case "LIST"   -> commands.aclList();
                        case "USERS"  -> commands.aclUsers();
                        case "GETUSER" -> { need("ACL GETUSER", t, 3); yield commands.aclGetuser(t[2]); }
                        case "CAT"    -> commands.aclCat();
                        default -> throw new IllegalArgumentException("ERR unknown ACL subcommand '" + t[1] + "'");
                    };
                }
                case "CONFIG"   -> {
                    need(cmd, t, 2);
                    yield switch (t[1].toUpperCase()) {
                        case "SET"       -> { need("CONFIG SET", t, 4); yield commands.configSet(t[2], t[3]); }
                        case "GET"       -> { need("CONFIG GET", t, 3); yield commands.configGet(t[2]); }
                        case "RESETSTAT" -> commands.configResetstat();
                        case "REWRITE"   -> commands.configRewrite();
                        default -> throw new IllegalArgumentException("ERR unknown CONFIG subcommand '" + t[1] + "'");
                    };
                }
                case "SLOWLOG"  -> {
                    need(cmd, t, 2);
                    yield switch (t[1].toUpperCase()) {
                        case "GET"   -> t.length > 2 ? commands.slowlogGet(Integer.parseInt(t[2])) : commands.slowlogGet();
                        case "RESET" -> commands.slowlogReset();
                        case "LEN"   -> commands.slowlogLen();
                        default -> throw new IllegalArgumentException("ERR unknown SLOWLOG subcommand '" + t[1] + "'");
                    };
                }
                case "CLIENT"   -> {
                    need(cmd, t, 2);
                    yield switch (t[1].toUpperCase()) {
                        case "LIST"    -> commands.clientList();
                        case "GETNAME" -> commands.clientGetname();
                        case "SETNAME" -> { need("CLIENT SETNAME", t, 3); yield commands.clientSetname(t[2]); }
                        case "ID"      -> commands.clientId();
                        default -> throw new IllegalArgumentException("ERR unknown CLIENT subcommand '" + t[1] + "'");
                    };
                }
                // Hash
                case "HGET"     -> { need(cmd, t, 3); yield commands.hget(t[1], t[2]); }
                case "HSET"     -> {
                    if (t.length < 4 || (t.length - 2) % 2 != 0) throw new IllegalArgumentException("Usage: HSET key field value [field value ...]");
                    Map<String, String> fvMap = new LinkedHashMap<>();
                    for (int i = 2; i < t.length; i += 2) fvMap.put(t[i], t[i + 1]);
                    yield commands.hset(t[1], fvMap);
                }
                case "HSETNX"   -> { need(cmd, t, 4); yield commands.hsetnx(t[1], t[2], t[3]); }
                case "HMSET"    -> {
                    if (t.length < 4 || (t.length - 2) % 2 != 0) throw new IllegalArgumentException("Usage: HMSET key field value [field value ...]");
                    Map<String, String> fvMap = new LinkedHashMap<>();
                    for (int i = 2; i < t.length; i += 2) fvMap.put(t[i], t[i + 1]);
                    yield commands.hmset(t[1], fvMap);
                }
                case "HMGET"    -> {
                    need(cmd, t, 3);
                    List<KeyValue<String, String>> kvs = commands.hmget(t[1], Arrays.copyOfRange(t, 2, t.length));
                    yield kvs.stream().map(kv -> kv.hasValue() ? kv.getValue() : null).collect(Collectors.toList());
                }
                case "HDEL"     -> { need(cmd, t, 3); yield commands.hdel(t[1], Arrays.copyOfRange(t, 2, t.length)); }
                case "HGETALL"  -> { need(cmd, t, 2); yield commands.hgetall(t[1]); }
                case "HKEYS"    -> { need(cmd, t, 2); yield commands.hkeys(t[1]); }
                case "HVALS"    -> { need(cmd, t, 2); yield commands.hvals(t[1]); }
                case "HLEN"     -> { need(cmd, t, 2); yield commands.hlen(t[1]); }
                case "HEXISTS"  -> { need(cmd, t, 3); yield commands.hexists(t[1], t[2]); }
                case "HINCRBY"  -> { need(cmd, t, 4); yield commands.hincrby(t[1], t[2], Long.parseLong(t[3])); }
                case "HINCRBYFLOAT" -> { need(cmd, t, 4); yield commands.hincrbyfloat(t[1], t[2], Double.parseDouble(t[3])); }
                // List
                case "LPUSH"    -> { need(cmd, t, 3); yield commands.lpush(t[1], Arrays.copyOfRange(t, 2, t.length)); }
                case "RPUSH"    -> { need(cmd, t, 3); yield commands.rpush(t[1], Arrays.copyOfRange(t, 2, t.length)); }
                case "LPUSHX"   -> { need(cmd, t, 3); yield commands.lpushx(t[1], Arrays.copyOfRange(t, 2, t.length)); }
                case "RPUSHX"   -> { need(cmd, t, 3); yield commands.rpushx(t[1], Arrays.copyOfRange(t, 2, t.length)); }
                case "LPOP"     -> { need(cmd, t, 2); yield commands.lpop(t[1]); }
                case "RPOP"     -> { need(cmd, t, 2); yield commands.rpop(t[1]); }
                case "LRANGE"   -> { need(cmd, t, 4); yield commands.lrange(t[1], Long.parseLong(t[2]), Long.parseLong(t[3])); }
                case "LLEN"     -> { need(cmd, t, 2); yield commands.llen(t[1]); }
                case "LINDEX"   -> { need(cmd, t, 3); yield commands.lindex(t[1], Long.parseLong(t[2])); }
                case "LSET"     -> { need(cmd, t, 4); yield commands.lset(t[1], Long.parseLong(t[2]), t[3]); }
                case "LREM"     -> { need(cmd, t, 4); yield commands.lrem(t[1], Long.parseLong(t[2]), t[3]); }
                case "LTRIM"    -> { need(cmd, t, 4); yield commands.ltrim(t[1], Long.parseLong(t[2]), Long.parseLong(t[3])); }
                // Set
                case "SADD"     -> { need(cmd, t, 3); yield commands.sadd(t[1], Arrays.copyOfRange(t, 2, t.length)); }
                case "SREM"     -> { need(cmd, t, 3); yield commands.srem(t[1], Arrays.copyOfRange(t, 2, t.length)); }
                case "SMEMBERS" -> { need(cmd, t, 2); yield commands.smembers(t[1]); }
                case "SCARD"    -> { need(cmd, t, 2); yield commands.scard(t[1]); }
                case "SISMEMBER"-> { need(cmd, t, 3); yield commands.sismember(t[1], t[2]); }
                case "SPOP"     -> { need(cmd, t, 2); yield commands.spop(t[1]); }
                case "SRANDMEMBER" -> { need(cmd, t, 2); yield t.length > 2 ? commands.srandmember(t[1], Long.parseLong(t[2])) : commands.srandmember(t[1]); }
                case "SUNION"   -> { need(cmd, t, 2); yield commands.sunion(Arrays.copyOfRange(t, 1, t.length)); }
                case "SINTER"   -> { need(cmd, t, 2); yield commands.sinter(Arrays.copyOfRange(t, 1, t.length)); }
                case "SDIFF"    -> { need(cmd, t, 2); yield commands.sdiff(Arrays.copyOfRange(t, 1, t.length)); }
                // Sorted Set
                case "ZADD"     -> {
                    if (t.length < 4 || (t.length - 2) % 2 != 0) throw new IllegalArgumentException("Usage: ZADD key score member [score member ...]");
                    if (t.length == 4) yield commands.zadd(t[1], Double.parseDouble(t[2]), t[3]);
                    List<ScoredValue<String>> svs = new ArrayList<>();
                    for (int i = 2; i < t.length; i += 2) svs.add(ScoredValue.just(Double.parseDouble(t[i]), t[i + 1]));
                    yield commands.zadd(t[1], svs.toArray(new ScoredValue[0]));
                }
                case "ZREM"     -> { need(cmd, t, 3); yield commands.zrem(t[1], Arrays.copyOfRange(t, 2, t.length)); }
                case "ZSCORE"   -> { need(cmd, t, 3); yield commands.zscore(t[1], t[2]); }
                case "ZINCRBY"  -> { need(cmd, t, 4); yield commands.zincrby(t[1], Double.parseDouble(t[2]), t[3]); }
                case "ZRANK"    -> { need(cmd, t, 3); yield commands.zrank(t[1], t[2]); }
                case "ZREVRANK" -> { need(cmd, t, 3); yield commands.zrevrank(t[1], t[2]); }
                case "ZCARD"    -> { need(cmd, t, 2); yield commands.zcard(t[1]); }
                case "ZCOUNT"   -> { need(cmd, t, 4); yield commands.zcount(t[1], scoreRange(t[2], t[3])); }
                case "ZRANGE"   -> { need(cmd, t, 4); yield commands.zrange(t[1], Long.parseLong(t[2]), Long.parseLong(t[3])); }
                case "ZREVRANGE"-> { need(cmd, t, 4); yield commands.zrevrange(t[1], Long.parseLong(t[2]), Long.parseLong(t[3])); }
                case "ZRANGEBYSCORE"   -> { need(cmd, t, 4); yield commands.zrangebyscore(t[1], scoreRange(t[2], t[3])); }
                case "ZREVRANGEBYSCORE"-> { need(cmd, t, 4); yield commands.zrevrangebyscore(t[1], scoreRange(t[3], t[2])); }
                case "ZREMRANGEBYRANK" -> { need(cmd, t, 4); yield commands.zremrangebyrank(t[1], Long.parseLong(t[2]), Long.parseLong(t[3])); }
                case "ZREMRANGEBYSCORE"-> { need(cmd, t, 4); yield commands.zremrangebyscore(t[1], scoreRange(t[2], t[3])); }
                // Stream
                case "XADD" -> {
                    need(cmd, t, 4);
                    String streamId = t[2];
                    if ((t.length - 3) % 2 != 0) throw new IllegalArgumentException("Usage: XADD key id field value [field value ...]");
                    Map<String, String> body = new LinkedHashMap<>();
                    for (int i = 3; i < t.length; i += 2) body.put(t[i], t[i + 1]);
                    if ("*".equals(streamId)) yield commands.xadd(t[1], body);
                    else yield commands.xadd(t[1], new XAddArgs().id(streamId), body);
                }
                case "XLEN"   -> { need(cmd, t, 2); yield commands.xlen(t[1]); }
                case "XDEL"   -> { need(cmd, t, 3); yield commands.xdel(t[1], Arrays.copyOfRange(t, 2, t.length)); }
                case "XRANGE" -> {
                    need(cmd, t, 4);
                    Range<String> r = buildStreamRange(t[2], t[3]);
                    if (t.length >= 6 && t[4].equalsIgnoreCase("COUNT")) {
                        yield commands.xrange(t[1], r, Limit.create(0, Integer.parseInt(t[5])));
                    }
                    yield commands.xrange(t[1], r);
                }
                case "XREVRANGE" -> {
                    need(cmd, t, 4);
                    Range<String> r = buildStreamRange(t[3], t[2]);
                    if (t.length >= 6 && t[4].equalsIgnoreCase("COUNT")) {
                        yield commands.xrevrange(t[1], r, Limit.create(0, Integer.parseInt(t[5])));
                    }
                    yield commands.xrevrange(t[1], r);
                }
                case "XINFO" -> {
                    need(cmd, t, 3);
                    yield switch (t[1].toUpperCase()) {
                        case "STREAM"    -> commands.xinfoStream(t[2]);
                        case "GROUPS"    -> commands.xinfoGroups(t[2]);
                        case "CONSUMERS" -> { need("XINFO CONSUMERS", t, 4); yield commands.xinfoConsumers(t[2], t[3]); }
                        default -> throw new IllegalArgumentException("ERR unknown XINFO subcommand '" + t[1] + "'");
                    };
                }
                case "XGROUP" -> {
                    need(cmd, t, 4);
                    yield switch (t[1].toUpperCase()) {
                        case "CREATE"  -> { need("XGROUP CREATE", t, 5); yield commands.xgroupCreate(buildStreamOffset(t[2], t[4]), t[3]); }
                        case "DESTROY" -> commands.xgroupDestroy(t[2], t[3]);
                        default -> throw new IllegalArgumentException("ERR unknown XGROUP subcommand '" + t[1] + "'");
                    };
                }
                case "XACK" -> {
                    need(cmd, t, 4);
                    yield commands.xack(t[1], t[2], Arrays.copyOfRange(t, 3, t.length));
                }
                // RedisJSON (module) — Lettuce has no typed API for these, dispatched raw
                case "JSON.SET" -> {
                    need(cmd, t, 4);
                    yield dispatchRaw(commands, cmd, new StatusOutput<>(StringCodec.UTF8), Arrays.copyOfRange(t, 1, t.length));
                }
                case "JSON.GET" -> {
                    need(cmd, t, 2);
                    yield dispatchRaw(commands, cmd, new ValueOutput<>(StringCodec.UTF8), Arrays.copyOfRange(t, 1, t.length));
                }
                case "JSON.DEL", "JSON.FORGET" -> {
                    need(cmd, t, 2);
                    yield dispatchRaw(commands, cmd, new IntegerOutput<>(StringCodec.UTF8), Arrays.copyOfRange(t, 1, t.length));
                }
                case "JSON.TYPE", "JSON.NUMINCRBY", "JSON.TOGGLE" -> {
                    need(cmd, t, 2);
                    yield dispatchRaw(commands, cmd, new ValueOutput<>(StringCodec.UTF8), Arrays.copyOfRange(t, 1, t.length));
                }
                case "JSON.STRLEN", "JSON.OBJLEN", "JSON.ARRLEN", "JSON.CLEAR", "JSON.ARRAPPEND" -> {
                    need(cmd, t, 2);
                    yield dispatchRaw(commands, cmd, new IntegerOutput<>(StringCodec.UTF8), Arrays.copyOfRange(t, 1, t.length));
                }
                case "JSON.OBJKEYS" -> {
                    need(cmd, t, 2);
                    yield dispatchRaw(commands, cmd, new ValueListOutput<>(StringCodec.UTF8), Arrays.copyOfRange(t, 1, t.length));
                }
                default -> throw new IllegalArgumentException("ERR unknown command '" + t[0] + "'");
            };
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("ERR value is not an integer or out of range");
        } catch (ArrayIndexOutOfBoundsException e) {
            throw new IllegalArgumentException("ERR wrong number of arguments for '" + cmd.toLowerCase() + "' command");
        }
    }

    // Raw command dispatch for module commands (RedisJSON etc.) that Lettuce has no typed API for.
    private static <T> T dispatchRaw(RedisCommands<String, String> commands, String commandName, CommandOutput<String, String, T> output, String... args) {
        CommandArgs<String, String> cmdArgs = new CommandArgs<>(StringCodec.UTF8);
        for (String a : args) cmdArgs.add(a);
        return commands.dispatch(protocolKeyword(commandName), output, cmdArgs);
    }

    private static ProtocolKeyword protocolKeyword(String name) {
        byte[] bytes = name.getBytes(java.nio.charset.StandardCharsets.US_ASCII);
        return new ProtocolKeyword() {
            @Override public byte[] getBytes() { return bytes; }
            @Override public String name() { return name; }
        };
    }

    private void need(String cmd, String[] t, int min) {
        if (t.length < min) {
            throw new IllegalArgumentException("ERR wrong number of arguments for '" + cmd.toLowerCase() + "' command");
        }
    }

    private Range<String> buildStreamRange(String start, String end) {
        Range.Boundary<String> lower = "-".equals(start) ? Range.Boundary.unbounded() : Range.Boundary.including(start);
        Range.Boundary<String> upper = "+".equals(end)   ? Range.Boundary.unbounded() : Range.Boundary.including(end);
        return Range.from(lower, upper);
    }

    private io.lettuce.core.XReadArgs.StreamOffset<String> buildStreamOffset(String key, String offset) {
        return io.lettuce.core.XReadArgs.StreamOffset.from(key, "0".equals(offset) ? "0-0" : offset);
    }

    private Range<Double> scoreRange(String min, String max) {
        Range.Boundary<Double> lower = parseBound(min, true);
        Range.Boundary<Double> upper = parseBound(max, false);
        return Range.from(lower, upper);
    }

    private Range.Boundary<Double> parseBound(String s, boolean isLower) {
        String lc = s.toLowerCase();
        if (lc.equals("-inf") || (isLower && lc.equals("inf"))) return Range.Boundary.unbounded();
        if (lc.equals("+inf") || lc.equals("inf")) return Range.Boundary.unbounded();
        if (s.startsWith("(")) return Range.Boundary.excluding(Double.parseDouble(s.substring(1)));
        return Range.Boundary.including(Double.parseDouble(s));
    }

    private String[] tokenize(String input) {
        List<String> tokens = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        boolean inSingle = false, inDouble = false;

        for (int i = 0; i < input.length(); i++) {
            char c = input.charAt(i);
            if (c == '\'' && !inDouble) {
                inSingle = !inSingle;
            } else if (c == '"' && !inSingle) {
                inDouble = !inDouble;
            } else if (c == ' ' && !inSingle && !inDouble) {
                if (cur.length() > 0) { tokens.add(cur.toString()); cur.setLength(0); }
            } else {
                cur.append(c);
            }
        }
        if (cur.length() > 0) tokens.add(cur.toString());
        return tokens.toArray(new String[0]);
    }

    @SuppressWarnings("unchecked")
    private String formatResult(Object result) {
        if (result == null) return "(nil)";
        if (result instanceof Boolean b) return b ? "(integer) 1" : "(integer) 0";
        if (result instanceof Long l) return "(integer) " + l;
        if (result instanceof Double d) return "\"" + d + "\"";
        if (result instanceof String s) {
            if (s.equals("OK") || s.equals("PONG") || s.equals("QUEUED")) return s;
            return "\"" + s + "\"";
        }
        if (result instanceof List<?> list) {
            if (list.isEmpty()) return "(empty array)";
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < list.size(); i++) {
                sb.append(i + 1).append(") ").append(formatResult(list.get(i))).append("\n");
            }
            return sb.toString().stripTrailing();
        }
        if (result instanceof Set<?> set) {
            if (set.isEmpty()) return "(empty array)";
            StringBuilder sb = new StringBuilder();
            int i = 1;
            for (Object item : set) {
                sb.append(i++).append(") ").append(formatResult(item)).append("\n");
            }
            return sb.toString().stripTrailing();
        }
        if (result instanceof Map<?, ?> map) {
            if (map.isEmpty()) return "(empty array)";
            StringBuilder sb = new StringBuilder();
            int i = 1;
            for (Map.Entry<?, ?> e : map.entrySet()) {
                Object val = e.getValue();
                if (val instanceof List) {
                    sb.append(i++).append(") ").append(formatResult(e.getKey())).append("\n");
                    sb.append(i++).append(") ").append(formatResult(val)).append("\n");
                } else {
                    sb.append(i++).append(") ").append(formatResult(e.getKey())).append("\n");
                    sb.append(i++).append(") ").append(formatResult(val)).append("\n");
                }
            }
            return sb.toString().stripTrailing();
        }
        return result.toString();
    }

    private RedisConnectionHolder connectTarget(CopyKeyRequest request) {
        RedisConnection target = new RedisConnection(request.getTargetHost(), request.getTargetPort(), request.getTargetPassword());
        target.setDb(request.getTargetDb());
        target.setAuthType(request.getTargetAuthType() != null ? request.getTargetAuthType() : AuthType.PASSWORD);
        target.setUsername(request.getTargetUsername());
        target.setUrl(request.getTargetUrl());
        target.setUseTls(request.isTargetUseTls());
        target.setMasterName(request.getTargetMasterName());
        target.setSentinelNodes(request.getTargetSentinelNodes());
        target.setSentinelPassword(request.getTargetSentinelPassword());
        target.setClusterNodes(request.getTargetClusterNodes());
        target.setSocketPath(request.getTargetSocketPath());
        return connect(target);
    }

    private RedisConnectionHolder connectTarget(BatchCopyRequest request) {
        RedisConnection target = new RedisConnection(request.getTargetHost(), request.getTargetPort(), request.getTargetPassword());
        target.setDb(request.getTargetDb());
        target.setAuthType(request.getTargetAuthType() != null ? request.getTargetAuthType() : AuthType.PASSWORD);
        target.setUsername(request.getTargetUsername());
        target.setUrl(request.getTargetUrl());
        target.setUseTls(request.isTargetUseTls());
        target.setMasterName(request.getTargetMasterName());
        target.setSentinelNodes(request.getTargetSentinelNodes());
        target.setSentinelPassword(request.getTargetSentinelPassword());
        target.setClusterNodes(request.getTargetClusterNodes());
        target.setSocketPath(request.getTargetSocketPath());
        return connect(target);
    }

    private RedisConnectionHolder connectTarget(DiskImportRequest request) {
        RedisConnection target = new RedisConnection(request.getTargetHost(), request.getTargetPort(), request.getTargetPassword());
        target.setDb(request.getTargetDb());
        target.setAuthType(request.getTargetAuthType() != null ? request.getTargetAuthType() : AuthType.PASSWORD);
        target.setUsername(request.getTargetUsername());
        target.setUrl(request.getTargetUrl());
        target.setUseTls(request.isTargetUseTls());
        target.setMasterName(request.getTargetMasterName());
        target.setSentinelNodes(request.getTargetSentinelNodes());
        target.setSentinelPassword(request.getTargetSentinelPassword());
        target.setClusterNodes(request.getTargetClusterNodes());
        target.setSocketPath(request.getTargetSocketPath());
        return connect(target);
    }

    private long parseLong(String s) {
        try { return Long.parseLong(s.trim()); } catch (Exception e) { return 0; }
    }

    private String formatUptime(long seconds) {
        if (seconds < 60) return seconds + "s";
        if (seconds < 3600) return (seconds / 60) + "m " + (seconds % 60) + "s";
        if (seconds < 86400) return (seconds / 3600) + "h " + ((seconds % 3600) / 60) + "m";
        return (seconds / 86400) + "d " + ((seconds % 86400) / 3600) + "h";
    }

    private Map<String, String> parseInfo(String info) {
        Map<String, String> map = new HashMap<>();
        if (info == null) return map;
        for (String line : info.split("\\r?\\n")) {
            if (line.isEmpty() || line.startsWith("#")) continue;
            int idx = line.indexOf(':');
            if (idx > 0) {
                map.put(line.substring(0, idx), line.substring(idx + 1));
            }
        }
        return map;
    }
}
