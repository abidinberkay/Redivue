package com.redivue.model;

import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
public class DiskImportRequest {
    private String fileId;
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
