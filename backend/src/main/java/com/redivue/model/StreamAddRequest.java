package com.redivue.model;

import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;

import java.util.Map;

@Data
@EqualsAndHashCode(callSuper = true)
@NoArgsConstructor
public class StreamAddRequest extends RedisConnection {
    private String key;
    private String entryId; // null or "*" → auto-generate
    private Map<String, String> fields;
}
