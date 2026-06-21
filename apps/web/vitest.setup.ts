// jest-dom のカスタムマッチャ（toBeInTheDocument など）を有効化する副作用 import。
// oxlint-disable-next-line no-unassigned-import
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
