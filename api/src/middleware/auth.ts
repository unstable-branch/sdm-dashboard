import { createMiddleware } from "hono/factory";
import { verify } from "hono/jwt";
import { db } from "../db";
import { users, projectMembers, projects } from "../db/schema";
import { eq, and } from "drizzle-orm";

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  iat: number;
  exp: number;
}

export interface AuthContext {
  user: {
    id: string;
    email: string;
    role: string;
  };
}

export const authMiddleware = createMiddleware<AuthContext>(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const token = authHeader.split(" ")[1];
  const secret = process.env.JWT_SECRET || "dev-secret-change-in-production";

  try {
    const payload = await verify(token, secret);
    c.set("user", {
      id: payload.sub as string,
      email: payload.email as string,
      role: payload.role as string,
    });
    await next();
  } catch {
    return c.json({ error: "Invalid token" }, 401);
  }
});

export const requireRole = (roles: string[]) => {
  return createMiddleware<AuthContext>(async (c, next) => {
    const user = c.get("user");
    if (!user || !roles.includes(user.role)) {
      return c.json({ error: "Forbidden" }, 403);
    }
    await next();
  });
};

export const requireProjectAccess = (role: "owner" | "member" = "member") => {
  return createMiddleware<AuthContext>(async (c, next) => {
    const user = c.get("user");
    const projectId = c.req.param("projectId") || c.req.query("project_id");

    if (!user || !projectId) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    if (user.role === "admin") {
      await next();
      return;
    }

    const [member] = await db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.userId, user.id), eq(projectMembers.projectId, projectId)))
      .limit(1);

    if (!member) {
      return c.json({ error: "Access denied" }, 403);
    }

    await next();
  });
};
