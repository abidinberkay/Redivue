package com.redivue.model;

import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;

@Data
@EqualsAndHashCode(callSuper = true)
@NoArgsConstructor
public class JsonSetRequest extends RedisConnection {
    private String key;
    private String path = "$"; // JSONPath — defaults to document root
    private String value;      // raw JSON text, sent as-is to JSON.SET (no shell tokenizing)
}
