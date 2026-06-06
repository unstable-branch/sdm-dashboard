import { db } from "../src/db/index.js";
import { users, projects } from "../src/db/schema.js";
import { eq } from "drizzle-orm";
import { hash } from "bcrypt";

const ADMIN_EMAIL = "admin@sdm.local";
const ADMIN_PASSWORD = "Admin123!";
const ADMIN_ID = "00000000-0000-0000-0000-000000000001";
const PROJECT_ID = "00000000-0000-0000-0000-000000000001";

async function seed() {
  const passwordHash = await hash(ADMIN_PASSWORD, 12);

  const existing = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);

  if (existing.length > 0) {
    await db.update(users)
      .set({ passwordHash, name: "Admin User", role: "admin" })
      .where(eq(users.email, ADMIN_EMAIL));
    console.log(`Updated admin user ${ADMIN_EMAIL} with new password hash`);
  } else {
    await db.insert(users).values({
      id: ADMIN_ID,
      email: ADMIN_EMAIL,
      passwordHash,
      name: "Admin User",
      role: "admin",
    });
    console.log(`Created admin user ${ADMIN_EMAIL}`);
  }

  const projectExists = await db.select().from(projects).where(eq(projects.id, PROJECT_ID)).limit(1);
  if (projectExists.length === 0) {
    await db.insert(projects).values({
      id: PROJECT_ID,
      name: "Default Project",
      description: "Default project for existing data",
      ownerId: ADMIN_ID,
    });
    console.log("Created default project");
  } else {
    console.log("Default project already exists");
  }

  console.log("Seed complete");
  console.log(`  Email: ${ADMIN_EMAIL}`);
  console.log(`  Password: ${ADMIN_PASSWORD}`);
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
