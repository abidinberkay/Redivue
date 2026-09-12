package com.redivue.config;

import com.redivue.model.RedisConnection;
import io.lettuce.core.SslOptions;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

class TlsHelperTest {

    // Self-signed CA cert/key generated on demand via `openssl` rather than committed as a
    // fixture — a throwaway private key checked into git still trips secret scanners and is bad
    // practice even for dummy test data (this project used to ship one; see SECURITY.md history).
    // Cached per-JVM so every test that needs one doesn't shell out again.
    private static String cachedCert;
    private static String cachedKey;
    private static boolean opensslMissing = false;

    private synchronized void ensureCaFixture() throws Exception {
        if (cachedCert != null || opensslMissing) return;
        Path dir = Files.createTempDirectory("redivue-test-tls");
        Path cert = dir.resolve("ca.pem");
        Path key = dir.resolve("ca-key.pem");
        Process p = new ProcessBuilder("openssl", "req", "-x509", "-newkey", "rsa:2048",
                "-keyout", key.toString(), "-out", cert.toString(), "-days", "1",
                "-nodes", "-subj", "/CN=redivue-test-ca")
                .redirectErrorStream(true).start();
        boolean finished = p.waitFor(30, java.util.concurrent.TimeUnit.SECONDS);
        if (!finished || p.exitValue() != 0 || !Files.exists(cert)) {
            opensslMissing = true;
            return;
        }
        cachedCert = Files.readString(cert);
        cachedKey = Files.readString(key);
    }

    private String caCert() throws Exception {
        ensureCaFixture();
        assumeTrue(!opensslMissing, "openssl not available on PATH — skipping TLS PEM-parsing test");
        return cachedCert;
    }

    private String caKey() throws Exception {
        ensureCaFixture();
        assumeTrue(!opensslMissing, "openssl not available on PATH — skipping TLS PEM-parsing test");
        return cachedKey;
    }

    private RedisConnection tlsConn() {
        RedisConnection c = new RedisConnection("h", 6379, null);
        c.setUseTls(true);
        return c;
    }

    // --- needsCustomTls decision matrix ---

    @Test
    void noTlsNeverNeedsCustomTls() {
        RedisConnection c = new RedisConnection("h", 6379, null);
        c.setTlsSkipVerify(true);
        c.setTlsCaCert("cert");
        assertThat(TlsHelper.needsCustomTls(c)).isFalse(); // useTls=false wins
    }

    @Test
    void plainTlsUsesSystemTrustStore() {
        assertThat(TlsHelper.needsCustomTls(tlsConn())).isFalse();
    }

    @Test
    void skipVerifyNeedsCustomTls() {
        RedisConnection c = tlsConn();
        c.setTlsSkipVerify(true);
        assertThat(TlsHelper.needsCustomTls(c)).isTrue();
    }

    @Test
    void caCertNeedsCustomTls() {
        RedisConnection c = tlsConn();
        c.setTlsCaCert("-----BEGIN CERTIFICATE-----");
        assertThat(TlsHelper.needsCustomTls(c)).isTrue();
    }

    @Test
    void clientCertNeedsCustomTls() {
        RedisConnection c = tlsConn();
        c.setTlsClientCert("-----BEGIN CERTIFICATE-----");
        assertThat(TlsHelper.needsCustomTls(c)).isTrue();
    }

    @Test
    void blankCertFieldsDoNotCount() {
        RedisConnection c = tlsConn();
        c.setTlsCaCert("   ");
        c.setTlsClientCert("");
        assertThat(TlsHelper.needsCustomTls(c)).isFalse();
    }

    // --- buildSslOptions ---

    @Test
    void skipVerifyBuildsInsecureOptions() throws Exception {
        RedisConnection c = tlsConn();
        c.setTlsSkipVerify(true);
        SslOptions options = TlsHelper.buildSslOptions(c);
        assertThat(options).isNotNull();
    }

    @Test
    void validCaCertPemIsAccepted() throws Exception {
        RedisConnection c = tlsConn();
        c.setTlsCaCert(caCert());
        SslOptions options = TlsHelper.buildSslOptions(c);
        assertThat(options).isNotNull();
    }

    @Test
    void invalidCaCertPemThrows() {
        RedisConnection c = tlsConn();
        c.setTlsCaCert("-----BEGIN CERTIFICATE-----\nnot base64!!!\n-----END CERTIFICATE-----");
        assertThatThrownBy(() -> TlsHelper.buildSslOptions(c)).isInstanceOf(Exception.class);
    }

    @Test
    void clientCertAndKeyBuildMutualTlsOptions() throws Exception {
        RedisConnection c = tlsConn();
        c.setTlsCaCert(caCert());
        c.setTlsClientCert(caCert());
        c.setTlsClientKey(caKey());
        SslOptions options = TlsHelper.buildSslOptions(c);
        assertThat(options).isNotNull();
    }

    @Test
    void clientCertWithoutKeyIsIgnored() throws Exception {
        RedisConnection c = tlsConn();
        c.setTlsSkipVerify(true);
        c.setTlsClientCert(caCert());
        // no key → keyManager branch must be skipped, not fail
        SslOptions options = TlsHelper.buildSslOptions(c);
        assertThat(options).isNotNull();
    }
}
