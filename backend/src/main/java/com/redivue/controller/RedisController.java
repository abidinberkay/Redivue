package com.redivue.controller;

import com.redivue.model.*;
import com.redivue.model.StreamAddRequest;
import com.redivue.model.StreamEntryDeleteRequest;
import com.redivue.service.ConnectionSessionRegistry;
import com.redivue.service.KeyspaceService;
import com.redivue.service.MonitorService;
import com.redivue.service.PubSubService;
import com.redivue.service.RedisService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/redis")
@RequiredArgsConstructor
@Slf4j
@CrossOrigin(origins = "http://localhost:3000")
public class RedisController {

    private final RedisService redisService;
    private final MonitorService monitorService;
    private final PubSubService pubSubService;
    private final KeyspaceService keyspaceService;
    private final ConnectionSessionRegistry sessionRegistry;

    /** Register connection credentials server-side and return an opaque session token for SSE endpoints. */
    @PostMapping("/{id}/session")
    public ResponseEntity<?> registerSession(@PathVariable String id, @RequestBody RedisConnection conn) {
        String token = sessionRegistry.register(conn);
        return ResponseEntity.ok(Map.of("sessionToken", token));
    }

    @PostMapping("/{id}/stats")
    public ResponseEntity<RedisStats> getStats(
            @PathVariable String id,
            @RequestBody RedisConnection connection) {
        try {
            RedisStats stats = redisService.getStats(connection);
            return ResponseEntity.ok(stats);
        } catch (Exception e) {
            log.error("Error fetching Redis stats", e);
            return ResponseEntity.badRequest().build();
        }
    }

    @PostMapping("/{id}/test")
    public ResponseEntity<String> testConnection(@PathVariable String id, @RequestBody RedisConnection connection) {
        try {
            redisService.getStats(connection);
            return ResponseEntity.ok("Connected successfully");
        } catch (Exception e) {
            return ResponseEntity.badRequest().body("Connection failed: " + e.getMessage());
        }
    }

    @PostMapping("/{id}/keys/scan")
    public ResponseEntity<KeyScanResult> scanKeys(@PathVariable String id, @RequestBody KeyScanRequest request) {
        try {
            return ResponseEntity.ok(redisService.scanKeys(request));
        } catch (Exception e) {
            log.error("Error scanning keys", e);
            return ResponseEntity.badRequest().build();
        }
    }

    @PostMapping("/{id}/keys/value")
    public ResponseEntity<KeyValueResult> getKeyValue(@PathVariable String id, @RequestBody KeyValueRequest request) {
        try {
            return ResponseEntity.ok(redisService.getKeyValue(request));
        } catch (Exception e) {
            log.error("Error getting key value", e);
            return ResponseEntity.badRequest().build();
        }
    }

    @PostMapping("/{id}/config/get")
    public ResponseEntity<?> configGet(@PathVariable String id, @RequestBody RedisConnection connection) {
        try {
            Map<String, String> config = redisService.configGet(connection);
            return ResponseEntity.ok(config);
        } catch (Exception e) {
            log.error("Error getting config", e);
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/{id}/config/set")
    public ResponseEntity<?> configSet(@PathVariable String id, @RequestBody ConfigSetRequest request) {
        try {
            redisService.configSet(request);
            return ResponseEntity.ok(Map.of("success", true));
        } catch (Exception e) {
            log.error("Error setting config", e);
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/{id}/key/rename")
    public ResponseEntity<?> renameKey(@PathVariable String id, @RequestBody KeyRenameRequest request) {
        try {
            redisService.renameKey(request);
            return ResponseEntity.ok(Map.of("success", true));
        } catch (Exception e) {
            log.error("Error renaming key", e);
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/{id}/key/delete")
    public ResponseEntity<?> deleteKey(@PathVariable String id, @RequestBody KeyDeleteRequest request) {
        try {
            boolean deleted = redisService.deleteKey(request);
            return ResponseEntity.ok(Map.of("deleted", deleted));
        } catch (Exception e) {
            log.error("Error deleting key", e);
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/{id}/keys/delete-batch")
    public ResponseEntity<?> deleteKeysBatch(@PathVariable String id, @RequestBody KeyBatchRequest request) {
        try {
            long deleted = redisService.deleteKeysBatch(request);
            return ResponseEntity.ok(Map.of("deleted", deleted));
        } catch (Exception e) {
            log.error("Error in batch delete", e);
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/{id}/keys/delete-by-pattern")
    public ResponseEntity<?> deleteByPattern(@PathVariable String id, @RequestBody PatternRequest request) {
        try {
            return ResponseEntity.ok(redisService.deleteByPattern(request));
        } catch (Exception e) {
            log.error("Error in pattern delete", e);
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/{id}/keys/set-ttl-batch")
    public ResponseEntity<?> setTtlBatch(@PathVariable String id, @RequestBody BatchTtlRequest request) {
        try {
            return ResponseEntity.ok(redisService.setTtlBatch(request));
        } catch (Exception e) {
            log.error("Error in batch TTL", e);
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/{id}/keys/values-batch")
    public ResponseEntity<?> getValuesBatch(@PathVariable String id, @RequestBody KeyBatchRequest request) {
        try {
            return ResponseEntity.ok(redisService.getValuesBatch(request));
        } catch (Exception e) {
            log.error("Error in batch values", e);
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/{id}/keys/copy-batch")
    public ResponseEntity<?> copyKeysBatch(@PathVariable String id, @RequestBody BatchCopyRequest request) {
        try {
            return ResponseEntity.ok(redisService.copyKeysBatch(request));
        } catch (Exception e) {
            log.error("Error in batch copy", e);
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/{id}/keys/scan-all")
    public ResponseEntity<KeyScanResult> scanAll(@PathVariable String id, @RequestBody PatternRequest request) {
        try {
            return ResponseEntity.ok(redisService.scanAll(request));
        } catch (Exception e) {
            log.error("Error in scan-all", e);
            return ResponseEntity.badRequest().build();
        }
    }

    @PostMapping("/{id}/key/set-string")
    public ResponseEntity<?> setString(@PathVariable String id, @RequestBody StringSetRequest request) {
        try {
            redisService.setString(request);
            return ResponseEntity.ok(Map.of("success", true));
        } catch (Exception e) {
            log.error("Error setting string", e);
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/{id}/key/json-set")
    public ResponseEntity<?> setJson(@PathVariable String id, @RequestBody JsonSetRequest request) {
        try {
            redisService.setJson(request);
            return ResponseEntity.ok(Map.of("success", true));
        } catch (Exception e) {
            log.error("Error setting JSON", e);
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/{id}/key/set-ttl")
    public ResponseEntity<?> setTtl(@PathVariable String id, @RequestBody TtlRequest request) {
        try {
            redisService.setTtl(request);
            return ResponseEntity.ok(Map.of("success", true));
        } catch (Exception e) {
            log.error("Error setting TTL", e);
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/{id}/key/hash-field")
    public ResponseEntity<?> hashFieldOp(@PathVariable String id, @RequestBody HashFieldRequest request) {
        try {
            redisService.hashFieldOp(request);
            return ResponseEntity.ok(Map.of("success", true));
        } catch (Exception e) {
            log.error("Error hash field operation", e);
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/{id}/key/list-op")
    public ResponseEntity<?> listOp(@PathVariable String id, @RequestBody ListOpRequest request) {
        try {
            redisService.listOp(request);
            return ResponseEntity.ok(Map.of("success", true));
        } catch (Exception e) {
            log.error("Error list operation", e);
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/{id}/key/set-op")
    public ResponseEntity<?> setOp(@PathVariable String id, @RequestBody SetOpRequest request) {
        try {
            redisService.setOp(request);
            return ResponseEntity.ok(Map.of("success", true));
        } catch (Exception e) {
            log.error("Error set operation", e);
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/{id}/key/zset-op")
    public ResponseEntity<?> zsetOp(@PathVariable String id, @RequestBody ZSetOpRequest request) {
        try {
            redisService.zsetOp(request);
            return ResponseEntity.ok(Map.of("success", true));
        } catch (Exception e) {
            log.error("Error zset operation", e);
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/{id}/key/stream-add")
    public ResponseEntity<?> streamAdd(@PathVariable String id, @RequestBody StreamAddRequest request) {
        try {
            String newId = redisService.addStreamEntry(request);
            return ResponseEntity.ok(Map.of("id", newId));
        } catch (Exception e) {
            log.error("Error adding stream entry", e);
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/{id}/key/stream-del")
    public ResponseEntity<?> streamDel(@PathVariable String id, @RequestBody StreamEntryDeleteRequest request) {
        try {
            long deleted = redisService.deleteStreamEntry(request);
            return ResponseEntity.ok(Map.of("deleted", deleted));
        } catch (Exception e) {
            log.error("Error deleting stream entry", e);
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/{id}/key/stream-groups")
    public ResponseEntity<?> streamGroups(@PathVariable String id, @RequestBody KeyValueRequest request) {
        try {
            return ResponseEntity.ok(redisService.getStreamGroups(request));
        } catch (Exception e) {
            log.error("Error getting stream groups", e);
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping(value = "/{id}/monitor/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter monitorStream(
            @PathVariable String id,
            @RequestParam(required = false) String sessionToken,
            @RequestParam(required = false) String host,
            @RequestParam(required = false, defaultValue = "6379") int port,
            @RequestParam(required = false) String password,
            @RequestParam(defaultValue = "60") int timeout) {
        long emitterTimeout = timeout == 0 ? Long.MAX_VALUE : (long) (timeout + 15) * 1000L;
        SseEmitter emitter = new SseEmitter(emitterTimeout);
        monitorService.startMonitor(resolveConnection(sessionToken, host, port, password, 0), timeout, emitter);
        return emitter;
    }

    @PostMapping("/{id}/slowlog")
    public ResponseEntity<?> getSlowLog(@PathVariable String id, @RequestBody Map<String, Object> body) {
        try {
            String host = (String) body.get("host");
            int port = ((Number) body.get("port")).intValue();
            String password = (String) body.get("password");
            int count = body.containsKey("count") ? ((Number) body.get("count")).intValue() : 25;
            List<SlowLogEntry> entries = monitorService.getSlowLog(new RedisConnection(host, port, password), count);
            return ResponseEntity.ok(entries);
        } catch (Exception e) {
            log.error("Error getting slow log", e);
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping(value = "/{id}/pubsub/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter pubsubStream(
            @PathVariable String id,
            @RequestParam(required = false) String sessionToken,
            @RequestParam(required = false) String host,
            @RequestParam(required = false, defaultValue = "6379") int port,
            @RequestParam(required = false) String password,
            @RequestParam(defaultValue = "0") int db,
            @RequestParam(required = false) String channels,
            @RequestParam(required = false) String patterns,
            @RequestParam(defaultValue = "300") int timeout) {
        long pubsubTimeout = timeout == 0 ? Long.MAX_VALUE : (long) (timeout + 15) * 1000L;
        SseEmitter emitter = new SseEmitter(pubsubTimeout);
        pubSubService.startSubscribe(resolveConnection(sessionToken, host, port, password, db),
                splitCsv(channels), splitCsv(patterns), timeout, emitter);
        return emitter;
    }

    @PostMapping("/{id}/publish")
    public ResponseEntity<?> publish(@PathVariable String id, @RequestBody Map<String, Object> body) {
        try {
            String host = (String) body.get("host");
            int port = ((Number) body.get("port")).intValue();
            String password = (String) body.get("password");
            int db = body.get("db") != null ? ((Number) body.get("db")).intValue() : 0;
            String channel = (String) body.get("channel");
            String message = (String) body.get("message");
            if (channel == null || channel.isBlank()) {
                return ResponseEntity.badRequest().body(Map.of("error", "Channel is required"));
            }
            RedisConnection conn = new RedisConnection(host, port, password);
            conn.setDb(db);
            long received = pubSubService.publish(conn, channel, message != null ? message : "");
            return ResponseEntity.ok(Map.of("received", received));
        } catch (Exception e) {
            log.error("Error publishing message", e);
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/{id}/pubsub/channels")
    public ResponseEntity<?> discoverChannels(
            @PathVariable String id,
            @RequestParam(required = false) String sessionToken,
            @RequestParam(required = false) String host,
            @RequestParam(required = false, defaultValue = "6379") int port,
            @RequestParam(required = false) String password,
            @RequestParam(defaultValue = "0") int db,
            @RequestParam(defaultValue = "*") String pattern) {
        try {
            return ResponseEntity.ok(pubSubService.discoverChannels(resolveConnection(sessionToken, host, port, password, db), pattern));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/{id}/keyspace/check")
    public ResponseEntity<?> keyspaceCheck(@PathVariable String id, @RequestBody com.redivue.model.CliRequest req) {
        try {
            req.setCommand("CONFIG GET notify-keyspace-events");
            com.redivue.model.CliResponse resp = redisService.executeCommand(req);
            String value = resp.getOutput() != null ? resp.getOutput() : "";
            // Response is like: 1) "notify-keyspace-events"\n2) "KEA"  (redis list format)
            String configValue = "";
            String[] lines = value.split("\n");
            for (int i = 0; i < lines.length; i++) {
                String line = lines[i].trim();
                // Look for line with "notify-keyspace-events"
                if (line.contains("notify-keyspace-events") && i + 1 < lines.length) {
                    configValue = lines[i + 1].trim();
                    break;
                }
            }
            // Clean up redis format: remove "2) " prefix and quotes
            configValue = configValue.replaceAll("^\\d+\\)\\s*", "").replaceAll("^\"|\"$", "").trim();
            boolean enabled = !configValue.isEmpty();
            return ResponseEntity.ok(Map.of("enabled", enabled, "value", configValue));
        } catch (Exception e) {
            log.error("Error checking keyspace config", e);
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/{id}/keyspace/enable")
    public ResponseEntity<?> keyspaceEnable(@PathVariable String id, @RequestBody com.redivue.model.CliRequest req) {
        try {
            req.setCommand("CONFIG SET notify-keyspace-events KEA");
            com.redivue.model.CliResponse resp = redisService.executeCommand(req);
            if (resp.getError() != null && !resp.getError().isBlank()) {
                return ResponseEntity.badRequest().body(Map.of("error", resp.getError()));
            }
            return ResponseEntity.ok(Map.of("ok", true));
        } catch (Exception e) {
            log.error("Error enabling keyspace notifications", e);
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping(value = "/{id}/keyspace/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter keyspaceStream(
            @PathVariable String id,
            @RequestParam(required = false) String sessionToken,
            @RequestParam(required = false) String host,
            @RequestParam(required = false, defaultValue = "6379") int port,
            @RequestParam(required = false) String password,
            @RequestParam(defaultValue = "0") int db,
            @RequestParam(defaultValue = "0") int timeout) {
        long emitterTimeout = timeout == 0 ? Long.MAX_VALUE : (long) (timeout + 15) * 1000L;
        SseEmitter emitter = new SseEmitter(emitterTimeout);
        keyspaceService.startListen(resolveConnection(sessionToken, host, port, password, db), timeout, emitter);
        return emitter;
    }

    /** Returns the full RedisConnection from session token if available; otherwise builds a minimal one from direct params. */
    private RedisConnection resolveConnection(String sessionToken, String host, int port, String password, int db) {
        if (sessionToken != null && !sessionToken.isBlank()) {
            RedisConnection conn = sessionRegistry.get(sessionToken);
            if (conn != null) return conn;
        }
        RedisConnection conn = new RedisConnection(host, port, password);
        conn.setDb(db);
        return conn;
    }

    private List<String> splitCsv(String value) {
        if (value == null || value.isBlank()) return List.of();
        return java.util.Arrays.stream(value.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .toList();
    }

    @PostMapping("/{id}/cli")
    public ResponseEntity<CliResponse> executeCliCommand(@PathVariable String id, @RequestBody CliRequest request) {
        try {
            CliResponse response = redisService.executeCommand(request);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.error("CLI error", e);
            return ResponseEntity.ok(CliResponse.builder().error(e.getMessage()).build());
        }
    }

    @PostMapping("/{id}/memory/analyze")
    public ResponseEntity<?> analyzeMemory(@PathVariable String id, @RequestBody MemoryAnalyzeRequest request) {
        try {
            return ResponseEntity.ok(redisService.analyzeMemory(request));
        } catch (Exception e) {
            log.error("Error in memory analysis", e);
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/{id}/migration/export-disk")
    public ResponseEntity<?> exportToDisk(@PathVariable String id, @RequestBody DiskExportRequest request) {
        try {
            return ResponseEntity.ok(redisService.exportToDisk(request));
        } catch (Exception e) {
            log.error("Error in disk export", e);
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/{id}/bulk/import-commands")
    public ResponseEntity<?> importCommands(@PathVariable String id, @RequestBody BulkCommandImportRequest request) {
        try {
            return ResponseEntity.ok(redisService.importCommands(request));
        } catch (Exception e) {
            log.error("Error in command import", e);
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/{id}/migration/import-disk")
    public ResponseEntity<?> importFromDisk(@PathVariable String id, @RequestBody DiskImportRequest request) {
        try {
            return ResponseEntity.ok(redisService.importFromDisk(request));
        } catch (Exception e) {
            log.error("Error in disk import", e);
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/{id}/migration/download/{fileId}")
    public ResponseEntity<byte[]> downloadExport(@PathVariable String id, @PathVariable String fileId) {
        try {
            byte[] data = redisService.downloadExport(fileId);
            return ResponseEntity.ok()
                    .header("Content-Disposition", "attachment; filename=\"redivue-export-" + fileId + ".json\"")
                    .header("Content-Type", "application/json")
                    .body(data);
        } catch (Exception e) {
            return ResponseEntity.notFound().build();
        }
    }

    @GetMapping("/{id}/migration/exports")
    public ResponseEntity<?> listExports(@PathVariable String id) {
        try {
            return ResponseEntity.ok(redisService.listExports());
        } catch (Exception e) {
            log.error("Error listing exports", e);
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @DeleteMapping("/{id}/migration/exports/{fileId}")
    public ResponseEntity<?> deleteExport(@PathVariable String id, @PathVariable String fileId) {
        try {
            redisService.deleteExport(fileId);
            return ResponseEntity.ok(Map.of("status", "deleted"));
        } catch (Exception e) {
            log.error("Error deleting export", e);
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/{id}/key/copy-to")
    public ResponseEntity<Map<String, Object>> copyKey(@PathVariable String id, @RequestBody CopyKeyRequest request) {
        try {
            Map<String, Object> result = redisService.copyKey(request);
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            log.error("Copy key error", e);
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/diff")
    public ResponseEntity<?> diffKey(@RequestBody DiffRequest request) {
        try {
            if (request.getKey() == null || request.getKey().isBlank()) {
                return ResponseEntity.badRequest().body(Map.of("error", "Key is required"));
            }
            return ResponseEntity.ok(redisService.getDiff(request));
        } catch (Exception e) {
            log.error("Error in key diff", e);
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }
}
