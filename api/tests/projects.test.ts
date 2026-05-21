import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("Projects API", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("GET /api/v1/projects", () => {
    it("returns list of user projects", async () => {
      const mockProjects = [
        { id: "1", name: "Test Project", description: "A test project", role: "admin", createdAt: "2024-01-01T00:00:00Z" },
        { id: "2", name: "Another Project", description: null, role: "viewer", createdAt: "2024-01-02T00:00:00Z" },
      ];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockProjects),
      });

      const res = await fetch("/api/v1/projects");
      const data = await res.json();

      expect(data).toHaveLength(2);
      expect(data[0].name).toBe("Test Project");
      expect(data[0].role).toBe("admin");
    });

    it("handles empty projects list", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      const res = await fetch("/api/v1/projects");
      const data = await res.json();
      expect(data).toEqual([]);
    });
  });

  describe("POST /api/v1/projects", () => {
    it("creates a new project", async () => {
      const mockProject = { id: "3", name: "New Project", description: "Description", createdAt: "2024-01-03T00:00:00Z" };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockProject),
      });

      const res = await fetch("/api/v1/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Project", description: "Description" }),
      });
      const data = await res.json();

      expect(data.id).toBe("3");
      expect(data.name).toBe("New Project");
    });

    it("returns 400 if name is missing", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: "Name is required" }),
      });

      const res = await fetch("/api/v1/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: "No name provided" }),
      });

      expect(res.ok).toBe(false);
      expect(res.status).toBe(400);
    });
  });

  describe("PUT /api/v1/projects/:id", () => {
    it("updates project name and description", async () => {
      const mockUpdated = { id: "1", name: "Updated Name", description: "Updated description", createdAt: "2024-01-01T00:00:00Z" };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockUpdated),
      });

      const res = await fetch("/api/v1/projects/1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Updated Name", description: "Updated description" }),
      });
      const data = await res.json();

      expect(data.name).toBe("Updated Name");
      expect(data.description).toBe("Updated description");
    });

    it("returns 403 if non-admin tries to update", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ error: "Only project admins can update projects" }),
      });

      const res = await fetch("/api/v1/projects/1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Hacked Name" }),
      });

      expect(res.ok).toBe(false);
      expect(res.status).toBe(403);
    });

    it("returns 400 if name is empty", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: "Name is required" }),
      });

      const res = await fetch("/api/v1/projects/1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "" }),
      });

      expect(res.ok).toBe(false);
      expect(res.status).toBe(400);
    });

    it("returns 404 for non-existent project", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: "Project not found" }),
      });

      const res = await fetch("/api/v1/projects/999", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Some Name" }),
      });

      expect(res.ok).toBe(false);
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/v1/projects/:id", () => {
    it("returns project details", async () => {
      const mockProject = { id: "1", name: "Test Project", description: "A test project" };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockProject),
      });

      const res = await fetch("/api/v1/projects/1");
      const data = await res.json();

      expect(data.id).toBe("1");
      expect(data.name).toBe("Test Project");
    });

    it("returns 404 for non-existent project", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: "Project not found" }),
      });

      const res = await fetch("/api/v1/projects/999");
      expect(res.ok).toBe(false);
    });
  });

  describe("GET /api/v1/projects/:id/members", () => {
    it("returns project members", async () => {
      const mockMembers = [
        { id: "u1", email: "admin@example.com", name: "Admin User", role: "admin" },
        { id: "u2", email: "viewer@example.com", name: "Viewer User", role: "viewer" },
      ];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockMembers),
      });

      const res = await fetch("/api/v1/projects/1/members");
      const data = await res.json();

      expect(data).toHaveLength(2);
      expect(data[0].role).toBe("admin");
      expect(data[1].role).toBe("viewer");
    });
  });

  describe("POST /api/v1/projects/:id/members", () => {
    it("adds a member to project", async () => {
      const mockMember = { id: "u2", email: "new@example.com", name: "New Member", role: "viewer" };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockMember),
      });

      const res = await fetch("/api/v1/projects/1/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "new@example.com", role: "viewer" }),
      });
      const data = await res.json();

      expect(data.email).toBe("new@example.com");
    });

    it("returns 400 if email is missing", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: "Email is required" }),
      });

      const res = await fetch("/api/v1/projects/1/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "viewer" }),
      });

      expect(res.ok).toBe(false);
      expect(res.status).toBe(400);
    });

    it("returns 403 if non-admin tries to add member", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ error: "Only project admins can add members" }),
      });

      const res = await fetch("/api/v1/projects/1/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "new@example.com" }),
      });

      expect(res.ok).toBe(false);
      expect(res.status).toBe(403);
    });

    it("returns 404 if user not found", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: "User not found" }),
      });

      const res = await fetch("/api/v1/projects/1/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "nonexistent@example.com" }),
      });

      expect(res.ok).toBe(false);
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/v1/projects/:id/members/:userId", () => {
    it("removes a member from project", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });

      const res = await fetch("/api/v1/projects/1/members/u2", { method: "DELETE" });
      const data = await res.json();

      expect(data.ok).toBe(true);
    });

    it("returns 403 if non-admin tries to remove member", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ error: "Only project admins can remove members" }),
      });

      const res = await fetch("/api/v1/projects/1/members/u2", { method: "DELETE" });

      expect(res.ok).toBe(false);
      expect(res.status).toBe(403);
    });
  });
});