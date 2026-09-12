package com.redivue.config;

import com.redivue.model.RedisConnection;
import io.lettuce.core.ClientOptions;
import io.lettuce.core.SslOptions;
import io.netty.handler.ssl.util.InsecureTrustManagerFactory;

import javax.net.ssl.TrustManagerFactory;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.attribute.PosixFilePermission;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.KeyStore;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.EnumSet;

/**
 * Builds Lettuce {@link ClientOptions} with custom TLS settings when
 * skip-verify, a custom CA cert, or client certificates are configured.
 */
public final class TlsHelper {

    private TlsHelper() {}

    /** Returns true when any TLS customization beyond the default trust store is needed. */
    public static boolean needsCustomTls(RedisConnection conn) {
        if (!conn.isUseTls()) return false;
        return conn.isTlsSkipVerify()
            || (conn.getTlsCaCert() != null && !conn.getTlsCaCert().isBlank())
            || (conn.getTlsClientCert() != null && !conn.getTlsClientCert().isBlank());
    }

    public static ClientOptions buildClientOptions(RedisConnection conn) throws Exception {
        return ClientOptions.builder()
            .sslOptions(buildSslOptions(conn))
            .build();
    }

    public static SslOptions buildSslOptions(RedisConnection conn) throws Exception {
        SslOptions.Builder ssl = SslOptions.builder();

        // --- Trust configuration ---
        if (conn.isTlsSkipVerify()) {
            // Netty's InsecureTrustManagerFactory accepts any certificate
            ssl.trustManager(InsecureTrustManagerFactory.INSTANCE);
        } else if (conn.getTlsCaCert() != null && !conn.getTlsCaCert().isBlank()) {
            // Parse PEM CA cert and load into a custom TrustManagerFactory
            X509Certificate caCert = parseCert(conn.getTlsCaCert());
            KeyStore ts = KeyStore.getInstance(KeyStore.getDefaultType());
            ts.load(null, null);
            ts.setCertificateEntry("ca", caCert);
            TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
            tmf.init(ts);
            ssl.trustManager(tmf);
        }

        // --- Client certificate (mutual TLS) ---
        if (conn.getTlsClientCert() != null && !conn.getTlsClientCert().isBlank()
                && conn.getTlsClientKey() != null && !conn.getTlsClientKey().isBlank()) {
            File certFile = writeTempPem(conn.getTlsClientCert(), "tls-cert");
            File keyFile  = writeTempPem(conn.getTlsClientKey(),  "tls-key");
            certFile.deleteOnExit();
            keyFile.deleteOnExit();
            // 3-argument form: (certFile, keyFile, keyPassword)
            ssl.keyManager(certFile, keyFile, new char[0]);
        }

        return ssl.build();
    }

    private static X509Certificate parseCert(String pem) throws Exception {
        CertificateFactory cf = CertificateFactory.getInstance("X.509");
        return (X509Certificate) cf.generateCertificate(
            new ByteArrayInputStream(pem.getBytes(StandardCharsets.UTF_8)));
    }

    // Client key material lands on disk in cleartext (Lettuce's keyManager() only takes files,
    // not byte[]) — restrict to owner-only so another local user on a shared host can't read it
    // during the process lifetime. POSIX perms first; setReadable/setWritable as a cross-platform
    // (Windows) fallback for anything that doesn't support PosixFileAttributeView.
    private static File writeTempPem(String pem, String prefix) throws Exception {
        java.nio.file.Path path;
        try {
            var perms = PosixFilePermissions.asFileAttribute(EnumSet.of(
                    PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE));
            path = Files.createTempFile(prefix + "-", ".pem", perms);
        } catch (UnsupportedOperationException e) {
            path = Files.createTempFile(prefix + "-", ".pem");
            File f = path.toFile();
            f.setReadable(false, false);
            f.setWritable(false, false);
            f.setReadable(true, true);
            f.setWritable(true, true);
        }
        Files.writeString(path, pem);
        return path.toFile();
    }
}
