FROM maven:3.9-eclipse-temurin-21-alpine AS build
RUN apk add --no-cache nodejs npm
# Keep the repo layout: the pom builds the frontend from ../frontend and Vite
# writes its output into ../backend/src/main/resources/static.
WORKDIR /src
COPY frontend/ frontend/
COPY backend/ backend/
WORKDIR /src/backend
RUN mvn clean package -DskipTests -q

FROM eclipse-temurin:25-jre-alpine
WORKDIR /app
COPY --from=build /src/backend/target/redivue-backend-*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
