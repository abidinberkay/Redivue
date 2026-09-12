package com.redivue.model;

import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;

@Data
@EqualsAndHashCode(callSuper = true)
@NoArgsConstructor
public class TtlRequest extends RedisConnection {
    private String key;
    private long ttl; // -1 = persist (remove TTL)
}
