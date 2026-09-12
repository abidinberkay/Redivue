package com.redivue.model;

import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;

@Data
@EqualsAndHashCode(callSuper = true)
@NoArgsConstructor
public class HashFieldRequest extends RedisConnection {
    private String key;
    private String field;
    private String value;
    private String operation; // "set" or "delete"
}
