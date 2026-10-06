import { useState } from "react";
import { Box } from "../components/Box.tsx";

export default function Search({ placeholder }: { placeholder: string }) {
  const [results, setResults] = useState<string[]>([]);
  async function search(q: string) {
    const response = await fetch(`/api/echo?q=${encodeURIComponent(q)}`);
    const body = (await response.json()) as { q: string };
    setResults([body.q]);
  }
  return (
    <Box>
      <input data-testid="q" placeholder={placeholder} onChange={(e) => search(e.target.value)} />
      <ul data-testid="results">
        {results.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </Box>
  );
}
