package com.redivue.config;

import com.redivue.model.AuthType;
import com.redivue.model.RedisConnection;
import io.lettuce.core.RedisURI;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class RedisURIHelperTest {

    private RedisConnection conn(AuthType type) {
        RedisConnection c = new RedisConnection("myhost", 6390, null);
        c.setAuthType(type);
        return c;
    }

    // --- PASSWORD (default) ---

    @Test
    void passwordAuthBuildsHostPortDb() {
        RedisConnection c = conn(AuthType.PASSWORD);
        c.setPassword("s3cret");
        c.setDb(3);
        RedisURI uri = RedisURIHelper.build(c);
        assertThat(uri.getHost()).isEqualTo("myhost");
        assertThat(uri.getPort()).isEqualTo(6390);
        assertThat(uri.getDatabase()).isEqualTo(3);
        assertThat(uri.getCredentialsProvider().resolveCredentials().block().getPassword()).isEqualTo("s3cret".toCharArray());
        assertThat(uri.isSsl()).isFalse();
    }

    @Test
    void nullAuthTypeFallsBackToPassword() {
        RedisConnection c = new RedisConnection("myhost", 6390, null);
        c.setAuthType(null);
        RedisURI uri = RedisURIHelper.build(c);
        assertThat(uri.getHost()).isEqualTo("myhost");
        assertThat(uri.getPort()).isEqualTo(6390);
    }

    @Test
    void blankPasswordIsNotSent() {
        RedisConnection c = conn(AuthType.PASSWORD);
        c.setPassword("  ");
        RedisURI uri = RedisURIHelper.build(c);
        assertThat(uri.getCredentialsProvider().resolveCredentials().block().hasPassword()).isFalse();
    }

    @Test
    void useTlsSetsSsl() {
        RedisConnection c = conn(AuthType.PASSWORD);
        c.setUseTls(true);
        assertThat(RedisURIHelper.build(c).isSsl()).isTrue();
    }

    // --- USERNAME_PASSWORD (ACL) ---

    @Test
    void aclAuthCarriesUsernameAndPassword() {
        RedisConnection c = conn(AuthType.USERNAME_PASSWORD);
        c.setUsername("app");
        c.setPassword("pw");
        RedisURI uri = RedisURIHelper.build(c);
        var creds = uri.getCredentialsProvider().resolveCredentials().block();
        assertThat(creds.getUsername()).isEqualTo("app");
        assertThat(creds.getPassword()).isEqualTo("pw".toCharArray());
    }

    @Test
    void aclAuthWithoutUsernameFallsBackToPasswordOnly() {
        RedisConnection c = conn(AuthType.USERNAME_PASSWORD);
        c.setPassword("pw");
        RedisURI uri = RedisURIHelper.build(c);
        var creds = uri.getCredentialsProvider().resolveCredentials().block();
        assertThat(creds.getUsername()).isNull();
        assertThat(creds.getPassword()).isEqualTo("pw".toCharArray());
    }

    // --- URL ---

    @Test
    void urlAuthParsesRedisUri() {
        RedisConnection c = conn(AuthType.URL);
        c.setUrl("rediss://:pw@example.com:6380/2");
        RedisURI uri = RedisURIHelper.build(c);
        assertThat(uri.getHost()).isEqualTo("example.com");
        assertThat(uri.getPort()).isEqualTo(6380);
        assertThat(uri.getDatabase()).isEqualTo(2);
        assertThat(uri.isSsl()).isTrue();
    }

    @Test
    void urlAuthRequiresUrl() {
        RedisConnection c = conn(AuthType.URL);
        assertThatThrownBy(() -> RedisURIHelper.build(c))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("redis://");
    }

    // --- SENTINEL ---

    @Test
    void sentinelAuthParsesNodesAndMaster() {
        RedisConnection c = conn(AuthType.SENTINEL);
        c.setMasterName("mymaster");
        c.setSentinelNodes("s1:26379, s2:26380 ,s3");
        c.setPassword("pw");
        c.setDb(1);
        RedisURI uri = RedisURIHelper.build(c);
        assertThat(uri.getSentinelMasterId()).isEqualTo("mymaster");
        assertThat(uri.getSentinels()).hasSize(3);
        assertThat(uri.getSentinels().get(0).getHost()).isEqualTo("s1");
        assertThat(uri.getSentinels().get(0).getPort()).isEqualTo(26379);
        assertThat(uri.getSentinels().get(1).getPort()).isEqualTo(26380);
        // node without explicit port defaults to 26379
        assertThat(uri.getSentinels().get(2).getHost()).isEqualTo("s3");
        assertThat(uri.getSentinels().get(2).getPort()).isEqualTo(26379);
        assertThat(uri.getDatabase()).isEqualTo(1);
    }

    @Test
    void sentinelAuthRequiresMasterNameAndNodes() {
        RedisConnection noMaster = conn(AuthType.SENTINEL);
        noMaster.setSentinelNodes("s1:26379");
        assertThatThrownBy(() -> RedisURIHelper.build(noMaster))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("master name");

        RedisConnection noNodes = conn(AuthType.SENTINEL);
        noNodes.setMasterName("mymaster");
        assertThatThrownBy(() -> RedisURIHelper.build(noNodes))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("sentinel node");
    }

    // --- SOCKET ---

    @Test
    void socketAuthBuildsSocketUri() {
        RedisConnection c = conn(AuthType.SOCKET);
        c.setSocketPath("/var/run/redis/redis.sock");
        RedisURI uri = RedisURIHelper.build(c);
        assertThat(uri.getSocket()).isEqualTo("/var/run/redis/redis.sock");
    }

    @Test
    void socketAuthRequiresPath() {
        assertThatThrownBy(() -> RedisURIHelper.build(conn(AuthType.SOCKET)))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("socket");
    }

    // --- CLUSTER ---

    @Test
    void clusterMustUseConnectNotBuild() {
        assertThatThrownBy(() -> RedisURIHelper.build(conn(AuthType.CLUSTER)))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("connect()");
    }

    // --- buildSimple (SSE fallback path) ---

    @Test
    void buildSimpleWithAndWithoutPassword() {
        RedisURI plain = RedisURIHelper.buildSimple("h", 6379, null, 0);
        assertThat(plain.getHost()).isEqualTo("h");
        assertThat(plain.getCredentialsProvider().resolveCredentials().block().hasPassword()).isFalse();
        assertThat(plain.getDatabase()).isEqualTo(0);

        RedisURI withPw = RedisURIHelper.buildSimple("h", 6379, "pw", 5);
        assertThat(withPw.getCredentialsProvider().resolveCredentials().block().getPassword()).isEqualTo("pw".toCharArray());
        assertThat(withPw.getDatabase()).isEqualTo(5);
    }
}
