package com.redivue.model;

import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;

@Data
@EqualsAndHashCode(callSuper = true)
@NoArgsConstructor
public class StringSetRequest extends RedisConnection {
    private String key;
    private String value;
    private long ttl; // -1 = no expiry
}
