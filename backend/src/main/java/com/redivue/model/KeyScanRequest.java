package com.redivue.model;

import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;

@Data
@EqualsAndHashCode(callSuper = true)
@NoArgsConstructor
public class KeyScanRequest extends RedisConnection {
    private String pattern = "*";
    private String cursor = "0";
    private int count = 100;
}
