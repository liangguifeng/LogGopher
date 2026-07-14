import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import LogstoreTree from "./LogstoreTree";

it("expands a project without rerendering its parent workspace", async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  let parentRenderCount = 0;

  function Workspace() {
    parentRenderCount += 1;
    return (
      <LogstoreTree
        groups={[
          { name: "project-a", logstores: ["app", "audit"] },
          { name: "project-b", logstores: ["worker"] },
        ]}
        activeGroup="project-a"
        activeLogstore="app"
        label="日志库"
        onSelect={onSelect}
      />
    );
  }

  render(<Workspace />);
  expect(parentRenderCount).toBe(1);

  const projectB = screen.getByRole("button", { name: /project-b/ });
  await user.click(projectB);
  expect(projectB).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("button", { name: "worker" })).toBeInTheDocument();
  expect(parentRenderCount).toBe(1);

  await user.click(screen.getByRole("button", { name: "worker" }));
  expect(onSelect).toHaveBeenCalledWith("project-b", "worker");
});
