package com.redivue.service;

import com.redivue.model.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Integration tests against a real Redis (project rule: never mock Redis).
 * Requires a running Docker daemon; skipped automatically without one.
 */
@Testcontainers(disabledWithoutDocker = true)
class RedisServiceIntegrationTest {

    @Container
    static final GenericContainer<?> REDIS =
        new GenericContainer<>("redis:7-alpine").withExposedPorts(6379);

    private final RedisService service = new RedisService();

    private static String host() { return REDIS.getHost(); }
    private static int port() { return REDIS.getMappedPort(6379); }

    /** Fill connection fields on any request DTO (they all extend RedisConnection). */
    private static <T extends RedisConnection> T fill(T req) {
        req.setHost(host());
        req.setPort(port());
        return req;
    }

    private CliResponse cli(String command) {
        CliRequest req = fill(new CliRequest());
        req.setCommand(command);
        return service.executeCommand(req);
    }

    private void setString(String key, String value, long ttl) {
        StringSetRequest req = fill(new StringSetRequest());
        req.setKey(key);
        req.setValue(value);
        req.setTtl(ttl);
        service.setString(req);
    }

    private KeyValueResult keyValue(String key) {
        KeyValueRequest req = fill(new KeyValueRequest());
        req.setKey(key);
        return service.getKeyValue(req);
    }

    @BeforeEach
    void flushAll() {
        assertThat(cli("FLUSHALL").getError()).isNull();
    }

    // --- Stats ---

    @Test
    void statsReflectServerState() {
        setString("stats:key", "v", 0);
        RedisStats stats = service.getStats(fill(new RedisConnection()));
        assertThat(stats.getTotalKeys()).isEqualTo(1);
        assertThat(stats.getRedisVersion()).startsWith("7.");
        assertThat(stats.getRole()).isEqualTo("master");
        assertThat(stats.getMemoryUsed()).isNotEqualTo("N/A");
    }

    // --- String / TTL ---

    @Test
    void stringRoundtripWithTtl() {
        setString("s:1", "hello world", 120);
        KeyValueResult r = keyValue("s:1");
        assertThat(r.getType()).isEqualTo("string");
        assertThat(r.getValue()).isEqualTo("hello world");
        assertThat(r.getTtl()).isBetween(1L, 120L);
        assertThat(r.getMemoryBytes()).isPositive();
        assertThat(r.getElementCount()).isEqualTo(11);
        assertThat(r.getEncoding()).isNotBlank();
    }

    @Test
    void missingKeyHasTypeNone() {
        KeyValueResult r = keyValue("does:not:exist");
        assertThat(r.getType()).isEqualTo("none");
        assertThat(r.getValue()).isNull();
    }

    @Test
    void setTtlThenPersist() {
        setString("ttl:1", "v", 0);

        TtlRequest expire = fill(new TtlRequest());
        expire.setKey("ttl:1");
        expire.setTtl(300);
        service.setTtl(expire);
        assertThat(keyValue("ttl:1").getTtl()).isBetween(1L, 300L);

        TtlRequest persist = fill(new TtlRequest());
        persist.setKey("ttl:1");
        persist.setTtl(-1);
        service.setTtl(persist);
        assertThat(keyValue("ttl:1").getTtl()).isEqualTo(-1);
    }

    // --- Hash / List / Set / ZSet ops ---

    @Test
    void hashFieldSetAndDelete() {
        HashFieldRequest set = fill(new HashFieldRequest());
        set.setKey("h:1"); set.setField("f1"); set.setValue("v1"); set.setOperation("set");
        service.hashFieldOp(set);
        HashFieldRequest set2 = fill(new HashFieldRequest());
        set2.setKey("h:1"); set2.setField("f2"); set2.setValue("v2"); set2.setOperation("set");
        service.hashFieldOp(set2);

        assertThat((Map<String, String>) keyValue("h:1").getValue())
            .containsExactlyInAnyOrderEntriesOf(Map.of("f1", "v1", "f2", "v2"));

        HashFieldRequest del = fill(new HashFieldRequest());
        del.setKey("h:1"); del.setField("f1"); del.setOperation("delete");
        service.hashFieldOp(del);
        assertThat((Map<String, String>) keyValue("h:1").getValue()).containsOnlyKeys("f2");
    }

    @Test
    void unknownHashOperationFails() {
        HashFieldRequest bad = fill(new HashFieldRequest());
        bad.setKey("h:x"); bad.setField("f"); bad.setOperation("upsert");
        assertThatThrownBy(() -> service.hashFieldOp(bad)).hasMessageContaining("Unknown operation");
    }

    @Test
    void listPushSetRemove() {
        ListOpRequest rpushA = fill(new ListOpRequest());
        rpushA.setKey("l:1"); rpushA.setValue("a"); rpushA.setOperation("rpush");
        service.listOp(rpushA);
        ListOpRequest rpushB = fill(new ListOpRequest());
        rpushB.setKey("l:1"); rpushB.setValue("b"); rpushB.setOperation("rpush");
        service.listOp(rpushB);
        ListOpRequest lpushZ = fill(new ListOpRequest());
        lpushZ.setKey("l:1"); lpushZ.setValue("z"); lpushZ.setOperation("lpush");
        service.listOp(lpushZ);
        assertThat((List<String>) keyValue("l:1").getValue()).containsExactly("z", "a", "b");

        ListOpRequest lset = fill(new ListOpRequest());
        lset.setKey("l:1"); lset.setValue("A"); lset.setIndex(1); lset.setOperation("lset");
        service.listOp(lset);
        ListOpRequest lrem = fill(new ListOpRequest());
        lrem.setKey("l:1"); lrem.setValue("z"); lrem.setOperation("lrem");
        service.listOp(lrem);
        assertThat((List<String>) keyValue("l:1").getValue()).containsExactly("A", "b");
    }

    @Test
    void setAddAndRemove() {
        SetOpRequest add = fill(new SetOpRequest());
        add.setKey("set:1"); add.setValue("m1"); add.setOperation("add");
        service.setOp(add);
        SetOpRequest add2 = fill(new SetOpRequest());
        add2.setKey("set:1"); add2.setValue("m2"); add2.setOperation("add");
        service.setOp(add2);
        assertThat((java.util.Collection<String>) keyValue("set:1").getValue()).containsExactlyInAnyOrder("m1", "m2");

        SetOpRequest rem = fill(new SetOpRequest());
        rem.setKey("set:1"); rem.setValue("m1"); rem.setOperation("remove");
        service.setOp(rem);
        assertThat((java.util.Collection<String>) keyValue("set:1").getValue()).containsExactly("m2");
    }

    @Test
    void zsetAddAndRemoveKeepsScores() {
        ZSetOpRequest add = fill(new ZSetOpRequest());
        add.setKey("z:1"); add.setMember("low"); add.setScore(1.5); add.setOperation("add");
        service.zsetOp(add);
        ZSetOpRequest add2 = fill(new ZSetOpRequest());
        add2.setKey("z:1"); add2.setMember("high"); add2.setScore(9.0); add2.setOperation("add");
        service.zsetOp(add2);

        List<Map<String, Object>> entries = (List<Map<String, Object>>) keyValue("z:1").getValue();
        assertThat(entries).hasSize(2);
        assertThat(entries.get(0)).containsEntry("member", "low").containsEntry("score", 1.5);
        assertThat(entries.get(1)).containsEntry("member", "high").containsEntry("score", 9.0);

        ZSetOpRequest rem = fill(new ZSetOpRequest());
        rem.setKey("z:1"); rem.setMember("low"); rem.setOperation("remove");
        service.zsetOp(rem);
        assertThat((List<?>) keyValue("z:1").getValue()).hasSize(1);
    }

    // --- Rename / Delete ---

    @Test
    void renameAndDeleteKey() {
        setString("old:name", "v", 0);
        KeyRenameRequest rename = fill(new KeyRenameRequest());
        rename.setKey("old:name");
        rename.setNewKey("new:name");
        service.renameKey(rename);
        assertThat(keyValue("old:name").getType()).isEqualTo("none");
        assertThat(keyValue("new:name").getValue()).isEqualTo("v");

        KeyDeleteRequest del = fill(new KeyDeleteRequest());
        del.setKey("new:name");
        assertThat(service.deleteKey(del)).isTrue();
        assertThat(service.deleteKey(del)).isFalse(); // already gone
    }

    // --- Scanning ---

    @Test
    void wildcardScanPaginatesUntilDone() {
        for (int i = 0; i < 25; i++) setString("scan:" + i, "v" + i, 0);

        KeyScanRequest req = fill(new KeyScanRequest());
        req.setPattern("*");
        req.setCount(10);
        req.setCursor("0");

        int total = 0;
        int pages = 0;
        KeyScanResult page;
        do {
            page = service.scanKeys(req);
            total += page.getKeys().size();
            req.setCursor(page.getNextCursor());
            pages++;
        } while (!page.isDone() && pages < 20);

        assertThat(page.isDone()).isTrue();
        assertThat(total).isEqualTo(25);
    }

    @Test
    void patternScanReturnsAllMatchesWithMetadata() {
        for (int i = 0; i < 5; i++) setString("user:" + i, "u", 600);
        setString("other:1", "o", 0);

        KeyScanRequest req = fill(new KeyScanRequest());
        req.setPattern("user:*");
        KeyScanResult result = service.scanKeys(req);

        assertThat(result.isDone()).isTrue();
        assertThat(result.getKeys()).hasSize(5);
        for (KeyInfo info : result.getKeys()) {
            assertThat(info.getKey()).startsWith("user:");
            assertThat(info.getType()).isEqualTo("string");
            assertThat(info.getTtl()).isBetween(1L, 600L);
            assertThat(info.getMemoryBytes()).isPositive();
        }
    }

    // --- Batch operations ---

    @Test
    void valuesBatchHandlesMixedAndMissingKeys() {
        setString("b:str", "sv", 0);
        cli("HSET b:hash f v");

        KeyBatchRequest req = fill(new KeyBatchRequest());
        req.setKeys(List.of("b:str", "b:hash", "b:missing"));
        List<Map<String, Object>> results = service.getValuesBatch(req);

        assertThat(results).hasSize(3);
        assertThat(results.get(0)).containsEntry("type", "string").containsEntry("value", "sv");
        assertThat(results.get(1)).containsEntry("type", "hash");
        assertThat((Map<String, String>) results.get(1).get("value")).containsEntry("f", "v");
        assertThat(results.get(2)).containsEntry("type", "none");
        assertThat(results.get(2).get("value")).isNull();
    }

    @Test
    void deleteKeysBatchCountsDeletions() {
        setString("d:1", "v", 0);
        setString("d:2", "v", 0);
        KeyBatchRequest req = fill(new KeyBatchRequest());
        req.setKeys(List.of("d:1", "d:2", "d:missing"));
        assertThat(service.deleteKeysBatch(req)).isEqualTo(2);
    }

    @Test
    void deleteByPatternUsesScanUnlink() {
        for (int i = 0; i < 7; i++) setString("del:" + i, "v", 0);
        setString("keep:1", "v", 0);

        PatternRequest req = fill(new PatternRequest());
        req.setPattern("del:*");
        Map<String, Object> result = service.deleteByPattern(req);

        assertThat(result).containsEntry("deleted", 7L).containsEntry("method", "SCAN+UNLINK");
        assertThat(keyValue("keep:1").getType()).isEqualTo("string");
    }

    @Test
    void deleteByPatternWildcardUsesFlushdb() {
        setString("f:1", "v", 0);
        setString("f:2", "v", 0);
        PatternRequest req = fill(new PatternRequest());
        req.setPattern("*");
        Map<String, Object> result = service.deleteByPattern(req);
        assertThat(result).containsEntry("deleted", 2L).containsEntry("method", "FLUSHDB");
    }

    @Test
    void ttlBatchAppliesToAllKeys() {
        setString("tb:1", "v", 0);
        setString("tb:2", "v", 0);
        BatchTtlRequest req = fill(new BatchTtlRequest());
        req.setKeys(List.of("tb:1", "tb:2"));
        req.setTtl(500);
        Map<String, Object> result = service.setTtlBatch(req);
        assertThat(result).containsEntry("updated", 2L).containsEntry("failed", 0L);
        assertThat(keyValue("tb:1").getTtl()).isBetween(1L, 500L);
        assertThat(keyValue("tb:2").getTtl()).isBetween(1L, 500L);
    }

    // --- Copy / Diff (cross-database) ---

    @Test
    void copyKeyToAnotherDbPreservesTtlAndSkipsExisting() {
        setString("cp:1", "payload", 900);

        CopyKeyRequest copy = fill(new CopyKeyRequest());
        copy.setKey("cp:1");
        copy.setTargetHost(host());
        copy.setTargetPort(port());
        copy.setTargetDb(1);
        assertThat(service.copyKey(copy)).containsEntry("status", "ok");

        KeyValueRequest inDb1 = fill(new KeyValueRequest());
        inDb1.setKey("cp:1");
        inDb1.setDb(1);
        KeyValueResult copied = service.getKeyValue(inDb1);
        assertThat(copied.getValue()).isEqualTo("payload");
        assertThat(copied.getTtl()).isBetween(1L, 900L);

        // second copy without replace must skip
        assertThat(service.copyKey(copy)).containsEntry("status", "skipped");
    }

    @Test
    void copyKeysBatchReportsPerKeyOutcome() {
        setString("bc:1", "v1", 0);
        setString("bc:2", "v2", 0);

        BatchCopyRequest req = fill(new BatchCopyRequest());
        req.setKeys(List.of("bc:1", "bc:2", "bc:missing"));
        req.setTargetHost(host());
        req.setTargetPort(port());
        req.setTargetDb(1);
        Map<String, Object> result = service.copyKeysBatch(req);

        assertThat((List<String>) result.get("succeeded")).containsExactlyInAnyOrder("bc:1", "bc:2");
        assertThat((List<Map<String, Object>>) result.get("failed")).hasSize(1);
        assertThat((List<String>) result.get("skipped")).isEmpty();
    }

    @Test
    void diffReportsMissingSide() {
        setString("diff:1", "left-only", 0);

        RedisConnection left = fill(new RedisConnection());
        RedisConnection right = new RedisConnection(host(), port(), null);
        right.setDb(1); // key exists only in db 0

        DiffRequest req = new DiffRequest();
        req.setKey("diff:1");
        req.setLeft(left);
        req.setRight(right);
        DiffResult result = service.getDiff(req);

        assertThat(result.getLeft().getValue()).isEqualTo("left-only");
        assertThat(result.getLeftError()).isNull();
        assertThat(result.getRight()).isNull();
        assertThat(result.getRightError()).isEqualTo("Key not found");
    }

    // --- Streams ---

    @Test
    void streamLifecycle() {
        StreamAddRequest add = fill(new StreamAddRequest());
        add.setKey("st:1");
        add.setFields(Map.of("temp", "21"));
        String id1 = service.addStreamEntry(add);
        assertThat(id1).matches("\\d+-\\d+");

        StreamAddRequest addExplicit = fill(new StreamAddRequest());
        addExplicit.setKey("st:1");
        addExplicit.setEntryId("9999999999999-0");
        addExplicit.setFields(Map.of("temp", "22"));
        assertThat(service.addStreamEntry(addExplicit)).isEqualTo("9999999999999-0");

        KeyValueResult r = keyValue("st:1");
        assertThat(r.getType()).isEqualTo("stream");
        List<Map<String, Object>> entries = (List<Map<String, Object>>) r.getValue();
        assertThat(entries).hasSize(2);
        assertThat((Map<String, String>) entries.get(0).get("fields")).containsEntry("temp", "21");

        // consumer group via CLI, then read groups
        assertThat(cli("XGROUP CREATE st:1 workers $").getError()).isNull();
        KeyValueRequest groupsReq = fill(new KeyValueRequest());
        groupsReq.setKey("st:1");
        Map<String, Object> groups = service.getStreamGroups(groupsReq);
        assertThat((Long) groups.get("length")).isEqualTo(2L);
        List<Map<String, Object>> groupList = (List<Map<String, Object>>) groups.get("groups");
        assertThat(groupList).hasSize(1);
        assertThat(groupList.get(0)).containsEntry("name", "workers");

        StreamEntryDeleteRequest del = fill(new StreamEntryDeleteRequest());
        del.setKey("st:1");
        del.setEntryId(id1);
        assertThat(service.deleteStreamEntry(del)).isEqualTo(1);
        assertThat((List<?>) keyValue("st:1").getValue()).hasSize(1);
    }

    @Test
    void streamAddRequiresFields() {
        StreamAddRequest add = fill(new StreamAddRequest());
        add.setKey("st:empty");
        assertThatThrownBy(() -> service.addStreamEntry(add)).hasMessageContaining("field");
    }

    // --- Memory analysis ---

    @Test
    void memoryAnalysisAggregatesByType() {
        setString("m:s1", "x".repeat(1000), 0);
        setString("m:s2", "y", 0);
        cli("HSET m:h1 f v");

        MemoryAnalyzeRequest req = fill(new MemoryAnalyzeRequest());
        req.setPattern("m:*");
        req.setLimit(100);
        Map<String, Object> result = service.analyzeMemory(req);

        assertThat(result).containsEntry("totalScanned", 3).containsEntry("sampled", false);
        assertThat((Long) result.get("totalBytes")).isPositive();
        Map<String, Long> byType = (Map<String, Long>) result.get("byType");
        assertThat(byType).containsKeys("string", "hash");

        // sorted by size desc — the 1000-char string must be first
        List<Map<String, Object>> keys = (List<Map<String, Object>>) result.get("keys");
        assertThat(keys.get(0)).containsEntry("key", "m:s1");
    }

    // --- CLI ---

    @Test
    void cliRoundtripAndQuoting() {
        assertThat(cli("PING").getOutput()).isEqualTo("PONG");
        assertThat(cli("SET cli:1 \"two words\"").getOutput()).isEqualTo("OK");
        assertThat(cli("GET cli:1").getOutput()).isEqualTo("\"two words\"");
        assertThat(cli("INCR cli:counter").getOutput()).isEqualTo("(integer) 1");
        assertThat(cli("GET cli:missing").getOutput()).isEqualTo("(nil)");
    }

    @Test
    void cliReportsErrorsWithoutThrowing() {
        CliResponse unknown = cli("NOSUCHCOMMAND arg");
        assertThat(unknown.getError()).isNotBlank();
        assertThat(unknown.getOutput()).isNull();

        CliResponse badArity = cli("GET");
        assertThat(badArity.getError()).isNotBlank();
    }

    // --- Bulk command import ---

    @Test
    void importCommandsSkipsCommentsAndReportsFailures() {
        BulkCommandImportRequest req = fill(new BulkCommandImportRequest());
        req.setCommands(List.of(
            "# a comment",
            "",
            "SET imp:1 hello",
            "HSET imp:2 f v",
            "BOGUSCMD nope"
        ));
        Map<String, Object> result = service.importCommands(req);

        assertThat(result).containsEntry("total", 5).containsEntry("succeeded", 2);
        List<Map<String, Object>> failed = (List<Map<String, Object>>) result.get("failed");
        assertThat(failed).hasSize(1);
        assertThat(failed.get(0)).containsEntry("command", "BOGUSCMD nope");

        assertThat(keyValue("imp:1").getValue()).isEqualTo("hello");
        assertThat(keyValue("imp:2").getType()).isEqualTo("hash");
    }

    // --- Config ---

    @Test
    void configSetAndGetRoundtrip() {
        ConfigSetRequest set = fill(new ConfigSetRequest());
        set.setParam("maxmemory");
        set.setValue("64mb");
        service.configSet(set);

        Map<String, String> config = service.configGet(fill(new RedisConnection()));
        assertThat(config).containsEntry("maxmemory", "67108864");

        set.setValue("0"); // restore
        service.configSet(set);
    }

    // --- Connection failure surfaces a clear error ---

    @Test
    void unreachableServerFailsWithClearMessage() {
        RedisConnection bad = new RedisConnection("localhost", 1, null);
        assertThatThrownBy(() -> service.getStats(bad))
            .isInstanceOf(RuntimeException.class)
            .hasMessageContaining("Failed to connect");
    }
}
