package com.redivue.model;

import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;

@Data
@EqualsAndHashCode(callSuper = true)
@NoArgsConstructor
public class ZSetOpRequest extends RedisConnection {
    private String key;
    private String member;
    private double score;
    private String operation; // "add", "remove"
}
