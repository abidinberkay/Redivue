package com.redivue.config;

import io.lettuce.core.RedisClient;
import io.lettuce.core.api.StatefulRedisConnection;
import io.lettuce.core.api.async.RedisAsyncCommands;
import io.lettuce.core.api.sync.RedisCommands;
import io.lettuce.core.codec.ByteArrayCodec;
import io.lettuce.core.cluster.RedisClusterClient;
import io.lettuce.core.cluster.api.StatefulRedisClusterConnection;
import io.lettuce.core.cluster.api.async.RedisAdvancedClusterAsyncCommands;
import io.lettuce.core.cluster.api.sync.RedisAdvancedClusterCommands;

import java.lang.reflect.Proxy;

/**
 * AutoCloseable wrapper around both standalone (RedisClient) and cluster
 * (RedisClusterClient) connections. Allows callers to use try-with-resources
 * regardless of connection type.
 */
public class RedisConnectionHolder implements AutoCloseable {

    private final AutoCloseable client;
    private final StatefulRedisConnection<String, String> standaloneConn;
    private final StatefulRedisClusterConnection<String, String> clusterConn;
    private final io.lettuce.core.resource.ClientResources externalResources;

    // Lazily-opened sibling connections with a binary codec — used only for
    // DUMP/RESTORE, whose payloads are not valid UTF-8 and would be mangled by
    // the String codec. Closed alongside the primary connection.
    private StatefulRedisConnection<byte[], byte[]> binaryStandaloneConn;
    private StatefulRedisClusterConnection<byte[], byte[]> binaryClusterConn;

    public RedisConnectionHolder(RedisClient c, StatefulRedisConnection<String, String> conn) {
        this.client = c;
        this.standaloneConn = conn;
        this.clusterConn = null;
        this.externalResources = null;
    }

    public RedisConnectionHolder(RedisClusterClient c, StatefulRedisClusterConnection<String, String> conn,
                                 io.lettuce.core.resource.ClientResources resources) {
        this.client = c;
        this.standaloneConn = null;
        this.clusterConn = conn;
        this.externalResources = resources;
    }

    public RedisCommands<String, String> sync() {
        if (standaloneConn != null) return standaloneConn.sync();
        return proxyAsCommands(clusterConn.sync());
    }

    public RedisAsyncCommands<String, String> async() {
        if (standaloneConn != null) return standaloneConn.async();
        return proxyAsAsyncCommands(clusterConn.async());
    }

    /**
     * Sync commands over a binary (byte[]) codec, for DUMP/RESTORE. The connection
     * is opened on first use and reused; it is closed by {@link #close()}.
     */
    public RedisCommands<byte[], byte[]> binarySync() {
        if (client instanceof RedisClient rc) {
            if (binaryStandaloneConn == null) binaryStandaloneConn = rc.connect(ByteArrayCodec.INSTANCE);
            return binaryStandaloneConn.sync();
        }
        RedisClusterClient rcc = (RedisClusterClient) client;
        if (binaryClusterConn == null) binaryClusterConn = rcc.connect(ByteArrayCodec.INSTANCE);
        return proxyAsBinaryCommands(binaryClusterConn.sync());
    }

    /**
     * RedisAdvancedClusterCommands and RedisCommands share the same method
     * signatures (both extend all the individual command sub-interfaces) but are
     * separate interface hierarchies — a direct cast always throws ClassCastException.
     * We bridge them with a JDK dynamic proxy so RedisService can use one type for
     * both standalone and cluster connections.
     */
    @SuppressWarnings("unchecked")
    private static RedisCommands<String, String> proxyAsCommands(
            RedisAdvancedClusterCommands<String, String> delegate) {
        return (RedisCommands<String, String>) Proxy.newProxyInstance(
                RedisCommands.class.getClassLoader(),
                new Class[]{RedisCommands.class},
                (proxy, method, args) -> invokeUnwrapped(delegate, method, args));
    }

    @SuppressWarnings("unchecked")
    private static RedisCommands<byte[], byte[]> proxyAsBinaryCommands(
            RedisAdvancedClusterCommands<byte[], byte[]> delegate) {
        return (RedisCommands<byte[], byte[]>) Proxy.newProxyInstance(
                RedisCommands.class.getClassLoader(),
                new Class[]{RedisCommands.class},
                (proxy, method, args) -> invokeUnwrapped(delegate, method, args));
    }

    @SuppressWarnings("unchecked")
    private static RedisAsyncCommands<String, String> proxyAsAsyncCommands(
            RedisAdvancedClusterAsyncCommands<String, String> delegate) {
        return (RedisAsyncCommands<String, String>) Proxy.newProxyInstance(
                RedisAsyncCommands.class.getClassLoader(),
                new Class[]{RedisAsyncCommands.class},
                (proxy, method, args) -> invokeUnwrapped(delegate, method, args));
    }

    private static Object invokeUnwrapped(Object delegate, java.lang.reflect.Method method, Object[] args)
            throws Throwable {
        try {
            return method.invoke(delegate, args);
        } catch (java.lang.reflect.InvocationTargetException e) {
            throw e.getCause() != null ? e.getCause() : e;
        }
    }

    public void setAutoFlushCommands(boolean autoFlush) {
        if (standaloneConn != null) standaloneConn.setAutoFlushCommands(autoFlush);
        else if (clusterConn != null) clusterConn.setAutoFlushCommands(autoFlush);
    }

    public void flushCommands() {
        if (standaloneConn != null) standaloneConn.flushCommands();
        else if (clusterConn != null) clusterConn.flushCommands();
    }

    public boolean isCluster() {
        return clusterConn != null;
    }

    @Override
    public void close() {
        try {
            if (binaryStandaloneConn != null) binaryStandaloneConn.close();
        } catch (Exception ignored) {}
        try {
            if (binaryClusterConn != null) binaryClusterConn.close();
        } catch (Exception ignored) {}
        try {
            if (standaloneConn != null) standaloneConn.close();
            else if (clusterConn != null) clusterConn.close();
        } catch (Exception ignored) {}
        try {
            if (client instanceof RedisClient rc) rc.shutdown();
            else if (client instanceof RedisClusterClient rcc) rcc.shutdown();
        } catch (Exception ignored) {}
        try {
            if (externalResources != null) externalResources.shutdown();
        } catch (Exception ignored) {}
    }
}
