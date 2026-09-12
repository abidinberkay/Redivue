package com.redivue.config;

import com.jcraft.jsch.Session;

/** Holds an active JSch SSH session and the locally forwarded port it exposes. */
public class SshTunnelSession {

    private final Session session;
    private final int localPort;

    public SshTunnelSession(Session session, int localPort) {
        this.session = session;
        this.localPort = localPort;
    }

    public Session getSession() { return session; }
    public int getLocalPort() { return localPort; }

    public void close() {
        try { session.disconnect(); } catch (Exception ignored) {}
    }
}
