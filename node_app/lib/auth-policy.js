const ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);

export const isEmailRegistrationEnabled = (env = process.env) => (
  env.NODE_ENV !== "production"
  && ENABLED_VALUES.has(String(env.REGISTRATION_ENABLED ?? "false").trim().toLowerCase())
);

export const isRestorableUser = (user) => {
  if (!user || typeof user !== "object" || !user.id || !user.emailLower) return false;
  if (user.passwordEnabled === false) {
    return typeof user.googleSub === "string" && user.googleSub.trim().length > 0;
  }
  return Boolean(user.passwordHash && user.passwordSalt);
};
