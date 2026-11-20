# The hosted image: Keycloak with the themes inside. Keep the tag the same as
# in docker-compose.yml.
FROM quay.io/keycloak/keycloak:26.8.2
COPY themes /opt/keycloak/themes
