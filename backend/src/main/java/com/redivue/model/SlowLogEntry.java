package com.redivue.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SlowLogEntry {
    private long id;
    private long timestamp;
    private long durationMicros;
    private List<String> command;
    private String clientAddr;
    private String clientName;
}
