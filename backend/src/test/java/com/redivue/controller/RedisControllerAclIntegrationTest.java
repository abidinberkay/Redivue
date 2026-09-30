package com.redivue.controller;

import com.redivue.service.ConnectionSessionRegistry;
import com.redivue.service.KeyspaceService;
import com.redivue.service.MonitorService;
import com.redivue.service.PubSubService;
import com.redivue.service.RedisService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Endpoints must honour the full connection body the frontend sends, not just host/port/password.
 * Runs against a real Redis whose default user is disabled, so any endpoint that drops the ACL
 * username fails to authenticate (project rule: never mock Redis).
 */
@Testcontainers(disabledWithoutDocker = true)
class RedisControllerAclIntegrationTest {

    @Container
    static final GenericContainer<?> REDIS = new GenericContainer<>("redis:7-alpine")
        .withCommand("redis-server", "--user", "default", "off",
                     "--user", "app", "on", ">apppass", "~*", "&*", "+@all")
        .withExposedPorts(6379);

    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        RedisController controller = new RedisController(new RedisService(), new MonitorService(),
            new PubSubService(), new KeyspaceService(), new ConnectionSessionRegistry());
        mvc = MockMvcBuilders.standaloneSetup(controller).build();
    }

    private static String aclConn() {
        return "\"host\":\"" + REDIS.getHost() + "\",\"port\":" + REDIS.getMappedPort(6379)
            + ",\"authType\":\"USERNAME_PASSWORD\",\"username\":\"app\",\"password\":\"apppass\",\"db\":0";
    }

    @Test
    void slowLogUsesAclUsername() throws Exception {
        mvc.perform(post("/api/redis/1/slowlog").contentType(MediaType.APPLICATION_JSON)
                .content("{" + aclConn() + ",\"count\":5}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$").isArray());
    }

    @Test
    void publishUsesAclUsername() throws Exception {
        mvc.perform(post("/api/redis/1/publish").contentType(MediaType.APPLICATION_JSON)
                .content("{" + aclConn() + ",\"channel\":\"news\",\"message\":\"hi\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.received").value(0));
    }

    @Test
    void publishRequiresChannel() throws Exception {
        mvc.perform(post("/api/redis/1/publish").contentType(MediaType.APPLICATION_JSON)
                .content("{" + aclConn() + ",\"channel\":\" \"}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("Channel is required"));
    }
}
