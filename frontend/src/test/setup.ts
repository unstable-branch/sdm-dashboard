import "@testing-library/jest-dom";
import { setupServer } from "msw/node";
import { getHandlers } from "../mocks/handlers";

export const server = setupServer(...getHandlers());

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());