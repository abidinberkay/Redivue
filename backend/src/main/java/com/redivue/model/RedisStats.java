package com.redivue.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class RedisStats {
    // Core
    private String memoryUsed;
    private long totalKeys;
    private long connectedClients;
    private String uptime;
    private String redisVersion;
    private String role;

    // Memory detail
    private String usedMemoryPeak;
    private String maxMemory;
    private String memFragmentationRatio;

    // Performance
    private long opsPerSec;
    private String hitRate;
    private long totalCommandsProcessed;
    private long totalConnectionsReceived;

    // Persistence
    private String rdbLastBgsaveStatus;
    private boolean aofEnabled;
}
