-- Keys are issued and revoked only by the owner role, from the command line. A flaw in the
-- running service can then neither mint a key nor reactivate a revoked one.
REVOKE INSERT, UPDATE ON api_keys FROM geo_app;

DROP TABLE admin_tokens;
