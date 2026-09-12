package com.redivue.model;

import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
public class CopyKeyRequest extends RedisConnection {
    private String key;
    private String targetHost;
    private int targetPort;
    private String targetPassword;
    private int targetDb = 0;
    private boolean replace;
    private AuthType targetAuthType = AuthType.PASSWORD;
    private String targetUsername;
    private String targetUrl;
    private boolean targetUseTls;
    private String targetMasterName;
    private String targetSentinelNodes;
    private String targetSentinelPassword;
    private String targetClusterNodes;
    private String targetSocketPath;
}
