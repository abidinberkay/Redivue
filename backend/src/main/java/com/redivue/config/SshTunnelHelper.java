package com.redivue.config;

import com.jcraft.jsch.JSch;
import com.jcraft.jsch.Session;
import com.redivue.model.RedisConnection;

import java.nio.charset.StandardCharsets;

/** Opens an SSH tunnel and returns the local port that forwards to the target Redis. */
public final class SshTunnelHelper {

    private SshTunnelHelper() {}

    public static SshTunnelSession open(RedisConnection conn) throws Exception {
        JSch jsch = new JSch();

        boolean hasKey = conn.getSshPrivateKey() != null && !conn.getSshPrivateKey().isBlank();
        if (hasKey) {
            byte[] keyBytes = conn.getSshPrivateKey().getBytes(StandardCharsets.UTF_8);
            byte[] passBytes = (conn.getSshPrivateKeyPassphrase() != null && !conn.getSshPrivateKeyPassphrase().isBlank())
                ? conn.getSshPrivateKeyPassphrase().getBytes(StandardCharsets.UTF_8)
                : null;
            jsch.addIdentity("redivue-key", keyBytes, null, passBytes);
        }

        int sshPort = conn.getSshPort() > 0 ? conn.getSshPort() : 22;
        Session session = jsch.getSession(conn.getSshUser(), conn.getSshHost(), sshPort);

        // StrictHostKeyChecking=no for dev-tool use; known_hosts verification can be added later
        session.setConfig("StrictHostKeyChecking", "no");
        session.setConfig("PreferredAuthentications", hasKey ? "publickey,password" : "password,publickey");

        if (conn.getSshPassword() != null && !conn.getSshPassword().isBlank()) {
            session.setPassword(conn.getSshPassword());
        }

        session.connect(15_000);

        // Port 0 → OS picks a free local port
        int localPort = session.setPortForwardingL(0, conn.getHost(), conn.getPort());
        return new SshTunnelSession(session, localPort);
    }
}
