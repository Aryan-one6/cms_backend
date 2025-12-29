import dotenv from "dotenv";
dotenv.config();
import app from "./app";

const port = Number(process.env.PORT || 5050);

app.listen(port, () => {
  console.log(`CMS Backend running on http://localhost:${port}`);
});
