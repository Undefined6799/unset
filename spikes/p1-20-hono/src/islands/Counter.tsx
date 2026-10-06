import { useState } from "react";
import { Box } from "../components/Box.tsx";

export default function Counter({ start }: { start: number }) {
  const [count, setCount] = useState(start);
  return (
    <Box>
      <button type="button" data-testid="count" onClick={() => setCount(count + 1)}>
        Count: {count}
      </button>
    </Box>
  );
}
