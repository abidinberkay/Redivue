package com.redivue.model;

import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@EqualsAndHashCode(callSuper = true)
@NoArgsConstructor
public class BatchTtlRequest extends RedisConnection {
    private List<String> keys;
    private long ttl;
}
