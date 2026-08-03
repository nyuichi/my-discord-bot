# Discord 同僚Bot（OpenAI GPT-5.6）

DiscordでBotをメンションしたときだけ、直近のチャンネル会話とチャンネル単位の要約を踏まえて返答する最小構成です。OpenAI Responses APIを使い、既定の `gpt-5.6` は現行のフラッグシップ `gpt-5.6-sol` にルーティングされます。モデルは `.env` で差し替えられます。

## 含まれる安全策

- Botへのメンション時だけAPIを呼び出す
- チャンネル許可リスト、チャンネル別クールダウン
- 月間推定費用と1日API呼び出し回数による事前ブロック
- 出力トークン上限と履歴文字数上限
- 標準service tier固定、自動再試行なし（1予約を1回のHTTP試行に対応させる）
- OpenAI側でレスポンスを保存しない `store: false`
- 生の会話履歴を永続化しない。保存するのは要約と集計使用量だけ
- ログは本文・プロンプト・返答・要約を含まず、ハッシュ化IDと使用量だけ
- Dockerの自動再起動、読み取り専用ファイルシステム、権限削減

> Bot内の費用上限は、設定した単価に基づく保守的なローカル防御です。価格変更やBot外からの同一キー利用までは止められません。OpenAI Platformの対象プロジェクトでも月額予算と通知を設定してください。

## 1. Discord Botを作る

1. [Discord Developer Portal](https://discord.com/developers/applications) で新しいApplicationを作成します。
2. **Bot** ページでBotを作り、Tokenを発行します。
3. **Privileged Gateway Intents** の **Message Content Intent** を有効にします。
4. **OAuth2 → URL Generator** で `bot` を選び、次の権限だけ付けてサーバーへ招待します。
   - View Channels
   - Send Messages
   - Read Message History
5. Botが読めるチャンネルをDiscord側のロール・チャンネル権限で必要最小限に絞ります。

## 2. 環境変数を設定する

この作業ディレクトリには、OpenAIキーを安全に保存した `.env` が既にあります。Discord Tokenと運用設定を追記します。キーの値をターミナル、チャット、Gitへ貼り付けないでください。

```bash
cp .env.example .env.example.local
# 手元の安全なエディタで .env を編集
chmod 600 .env
```

最低限必要なのは次の2つです（OpenAIキーは作成済みです）。

```dotenv
DISCORD_TOKEN=DiscordのBotトークン
OPENAI_API_KEY=作成済みの値を維持
```

特定チャンネルだけで動かす場合は、Discordの開発者モードでチャンネルIDをコピーし、カンマ区切りで指定します。

```dotenv
ALLOWED_CHANNEL_IDS=123456789012345678,234567890123456789
```

## 3. ローカル確認

Node.js 22以上がある場合:

```bash
npm ci
npm run check
npm run build
```

実際のDiscord接続はDockerで確認できます。

```bash
docker compose up --build
```

別のDiscordユーザーから `@Bot こんにちは` と送り、返信することを確認します。メンションしない投稿には反応しません。

## 4. VPSへ配置する

例としてVPS上の `/opt/demachi-discord-bot` に、`.env` を含めて安全な方法で転送します。`.env` はGitへ入れず、VPS上でも所有者だけが読めるようにします。

```bash
cd /opt/demachi-discord-bot
chmod 600 .env
docker compose up -d --build
docker compose ps
docker compose logs --tail=50 bot
```

`restart: unless-stopped` により、プロセス異常終了とVPS再起動後にDockerがBotを再起動します。Docker自体もOS起動時に有効化してください（一般的なLinuxでは `systemctl enable --now docker`）。更新時はファイルを差し替え、同じディレクトリで `docker compose up -d --build` を実行します。

## 費用上限

既定値は次のとおりです。

- 月間推定上限: `$20`
- 1日のAPI呼び出し上限: `80`（返答と要約を合算、UTC日付）
- 1回答の最大生成量: `2,000` tokens（推論トークンを含むAPI上限）
- チャンネルの直近履歴: 30件、最大12,000文字

費用はAPIレスポンスのトークン使用量から `data/state.json` に集計します。呼び出し前にはUTF-8バイト数と最大出力量を使った保守的な金額を仮予約するため、上限直前では実際の残額より早めに停止する場合があります。ネットワーク障害時の曖昧な課金も予約額を残す設計です。SDKの自動再試行は無効にし、日次回数と予約が実際のHTTP試行数に対応するようにしています。

`gpt-5.6-sol` の標準API単価（2026-08-03確認）は入力 `$5`、キャッシュ入力 `$0.50`、出力 `$30` / 100万tokensです。明示キャッシュ書き込みは `$6.25` として初期設定しています。価格やモデルを変えたら、`.env` の4つの `PRICE_*` も必ず更新してください。

## 保存データとログ

Docker volumeの `/app/data/state.json` だけが永続化されます。チャンネルごとの短い要約には会話内容の一部が抽象化されて残るため、機密チャンネルへBotを入れないでください。要約プロンプトは秘密・連絡先・機微な個人情報・逐語引用を除外するよう指定していますが、完全な自動除去は保証できません。

状態を消す場合はBotを停止し、対象のDocker volumeを特定して削除します。削除すると要約とローカル使用量カウンターの両方が消えるため、OpenAI Platform側の実使用量を確認してから行ってください。

ログ確認:

```bash
docker compose logs -f bot
```

ログに出るのはイベント名、ハッシュ化したユーザー/チャンネルID、処理時間、トークン数、推定費用、エラー種別だけです。Discord本文やOpenAI入出力は出しません。

## 主な設定

| 変数 | 既定値 | 用途 |
|---|---:|---|
| `OPENAI_MODEL` | `gpt-5.6` | 利用モデル |
| `OPENAI_REASONING_EFFORT` | `low` | 推論量 |
| `MONTHLY_BUDGET_USD` | `20` | Bot内の月間推定上限 |
| `MAX_DAILY_API_CALLS` | `80` | UTC日単位の呼び出し上限 |
| `MAX_OUTPUT_TOKENS` | `2000` | 返答ごとの生成上限 |
| `HISTORY_MESSAGE_LIMIT` | `30` | 読む直近投稿数 |
| `SUMMARY_EVERY_MENTIONS` | `8` | 要約更新間隔 |
| `ALLOWED_CHANNEL_IDS` | 空 | 空ならBotが見える全チャンネル |

## トラブルシューティング

- 起動直後に落ちる: `docker compose logs bot` を確認し、必須環境変数を設定します。
- メンションしても無反応: Message Content Intent、View Channels、Read Message History、Send Messagesを確認します。
- OpenAIの401/403: キーのプロジェクトとAPI利用権限を確認します。キー値はログへ出さないでください。
- 上限で停止: `.env` の上限だけを安易に上げず、`data/state.json` の集計とOpenAI PlatformのUsageを比較します。

公式資料: [最新モデル案内](https://developers.openai.com/api/docs/guides/latest-model)、[Responses APIによるテキスト生成](https://developers.openai.com/api/docs/guides/text)、[API料金](https://developers.openai.com/api/docs/pricing)
