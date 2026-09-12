package com.redivue.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class KeyValueResult {
    private String key;
    private String type;
    private Object value;
    private long ttl;
    private Long memoryBytes;
    private String encoding;
    private Long elementCount;
}
