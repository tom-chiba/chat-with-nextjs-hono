import { APP_NAME } from "@repo/shared";

export default function Home() {
  return (
    <main>
      <h1>{APP_NAME}</h1>
      <p>PWA を使った軽量チャットツール</p>
    </main>
  );
}
