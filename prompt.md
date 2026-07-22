 Use the robinhood-trading MCP tools only (read-only).
  1. Call get_accounts.
  2. For each account, call get_portfolio and get_equity_positions.
  3. Summarize account type, cash, buying power, portfolio equity/market value, and open equity positions (symbol, quantity, average cost if available). Do NOT place, review, or cancel any orders. If Robinhood tools are missing or return auth errors, say so clearly and stop.