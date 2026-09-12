FROM maven:3.9-eclipse-temurin-21-alpine AS build
RUN apk add --no-cache nodejs npm
WORKDIR /app
COPY backend/ .
RUN mvn clean package -DskipTests -q

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --from=build /app/target/redivue-backend-*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
