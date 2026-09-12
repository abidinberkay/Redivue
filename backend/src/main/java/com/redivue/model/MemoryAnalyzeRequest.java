package com.redivue.model;

import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;

@Data
@EqualsAndHashCode(callSuper = true)
@NoArgsConstructor
public class MemoryAnalyzeRequest extends RedisConnection {
    private String pattern;
    private int limit = 10000;
}
