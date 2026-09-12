package com.redivue.model;

import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;

@Data
@EqualsAndHashCode(callSuper = true)
@NoArgsConstructor
public class SetOpRequest extends RedisConnection {
    private String key;
    private String value;
    private String operation; // "add" or "remove"
}
