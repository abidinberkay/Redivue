package com.redivue.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class KeyInfo {
    private String key;
    private String type;
    private long ttl;
    private Long memoryBytes;
}
