# TokenPet

**A pixel pet for your AI coding agent's CLI.**

Claude Code와 Codex CLI에서 함께 키우는 픽셀 펫. **360종**, 5개 등급, 개발하면서 버는 코인, 뽑기, 성장, 돌봄, 공유 도감을 제공합니다. 웹을 열지 않고 터미널 안에서 플레이할 수 있습니다.

<p align="center">
  <img src="docs/screenshots/codex-pet.gif" width="480" alt="Codex CLI에서 움직이는 별의 루루와 포만감·기분·에너지·청결 패널">
</p>

**CLI 안에서 함께하는 별의 루루.** 실행 중인 Codex CLI의 펫 영역을 8초간 캡처한 GIF입니다. 오른쪽 패널은 위에서부터 포만감·기분·에너지·청결을 보여줍니다.

**일반 설치는 개인 PC용입니다.** 회원가입 없이 시작하고 펫과 게임 기록을 이 컴퓨터에 저장합니다. 여러 사람이 함께 쓰는 회원 서버는 운영자가 Docker로 따로 실행합니다.

| 구분 | 개인 PC용 (기본 설치) | 운영자용 Docker 서버 |
| --- | --- | --- |
| 저장 위치 | 내 PC의 `.tokenpet` | 서버의 `/data` 볼륨, 회원별 분리 |
| 시작 방법 | 설치 후 Claude·Codex 실행 | Docker로 실행한 웹에서 회원가입 |
| 로그인·토큰 발급·랭킹 | 사용하지 않음 | 서버에서 제공 |
| CLI 연결 | 자동으로 개인 작업실 사용 | `tokenpet connect <서버 주소>` 후 회원 API 키 입력 |

서버를 이용하는 사람도 같은 CLI를 설치하면 됩니다. 운영자에게 받은 서버 주소와 본인 계정의 연결 토큰으로 접속하며, 개인용 Docker를 띄울 필요는 없습니다. 로컬과 서버의 게임은 독립적으로 보관됩니다.

[설치하기](#시작) · [웹 화면](#웹-화면) · [CLI 명령](#cli--mcp) · [Docker 서버](#docker-서버)

## 웹 화면

아래는 **Docker 서버 모드**의 실제 웹 화면입니다. 개인 PC용에도 작업실·도감·돌봄·부화·CLI 연동 화면을 제공하며, 회원가입·로그인·연결 토큰 발급·랭킹은 서버 모드에서만 표시합니다. 모든 이미지는 **1920 × 1080**으로 캡처했으며, 계정·보유 펫·랭킹은 소개용 예시 데이터입니다. 이미지를 누르면 원본 크기로 볼 수 있습니다.

### 나의 작업실

함께하는 펫의 레벨과 포만감·행복·에너지·청결을 확인하고, 밥 주기·놀아주기·씻기·재우기로 돌봅니다. 코인 잔액, 모은 친구들, 알 부화도 같은 화면에서 확인할 수 있습니다.

![나의 작업실 — 펫의 성장과 돌봄 상태, 보유 친구, 알 부화](docs/screenshots/workspace.png)

<details>
<summary>시작 화면 — 서비스 소개와 회원가입</summary>

처음 방문하면 게임 소개와 보상 기준을 볼 수 있습니다. 아이디·비밀번호·닉네임으로 가입하면 첫 친구와 300 C로 시작하며, 도감과 랭킹은 로그인 없이도 둘러볼 수 있습니다.

![시작 화면 — 게임 소개, 회원가입, 토큰 보상 기준](docs/screenshots/welcome.png)

</details>

<details>
<summary>친구 도감 — 전체 360종과 내가 보유한 친구</summary>

전체 도감에서 5개 등급의 펫을 검색하고, 아직 만나지 못한 친구도 미리 볼 수 있습니다. 캐릭터를 누르면 큰 그림과 상세 정보가 열립니다.

![전체 도감 — 360종의 펫, 등급 필터와 이름 검색](docs/screenshots/catalog.png)

로그인하면 **내가 보유한 친구**만 모아 볼 수 있습니다. 각 펫의 레벨·보유 수량·수면 상태를 확인하고 함께할 친구를 선택합니다.

![내 보유 도감 — 등급별로 모은 친구와 현재 함께하는 펫](docs/screenshots/collection.png)

</details>

<details>
<summary>친구 랭킹 — 가장 많이 자란 펫과 다양한 수집 기록</summary>

**성장 랭킹**은 회원마다 가장 레벨이 높은 한 마리를 비교합니다. 내 순위는 목록 위에 따로 표시합니다.

![성장 랭킹 — 회원별 최고 레벨 펫과 내 순위](docs/screenshots/rankings-level.png)

**수집 랭킹**은 서로 다른 펫의 종류 수로 정합니다. 중복 펫은 종류 수에 더하지 않으며, 전체 보유 마리 수는 함께 표시합니다.

![수집 랭킹 — 서로 다른 펫 종류 수와 전체 보유 수량](docs/screenshots/rankings-collection.png)

</details>

<details>
<summary>알 부화소 — 새로운 친구와의 만남</summary>

100 C로 한 번, 1,000 C로 열 번 부화할 수 있습니다. 등급별 확률과 전설 펫 보장까지 남은 횟수를 확인할 수 있고, 중복 펫을 만나면 보유 수량과 경험치가 늘어납니다.

![알 부화소 — 1회·10회 뽑기, 등급별 확률과 전설 보장 진행도](docs/screenshots/hatch.png)

</details>

<details>
<summary>CLI 연동 — 연결 토큰과 Claude·Codex 설정</summary>

회원당 연결 토큰 하나를 발급해 여러 CLI에서 사용합니다. 재발급하면 기존 토큰은 즉시 폐기됩니다. 연결 명령과 Claude Code·Codex CLI의 사용량도 이 화면에서 확인합니다.

![CLI 연동 — 회원 토큰 발급과 터미널 연결 안내](docs/screenshots/connect.png)

</details>

## 시작

Claude Code 또는 Codex CLI가 설치된 **Windows / macOS / Linux / WSL (arm64·x64)**에서 아래 명령을 복사해 실행하세요. Git 설치나 repository clone은 필요하지 않습니다. Node.js 24 이상이 없으면 설치 프로그램이 전용 폴더에 준비합니다.

**macOS / Linux / WSL:**

```sh
curl -fsSL https://raw.githubusercontent.com/shariest/tokenpet/main/install.sh | bash
```

**Windows 10/11 — PowerShell 5.1 이상:**

```powershell
irm https://raw.githubusercontent.com/shariest/tokenpet/main/install.ps1 | iex
```

관리자 권한이나 WSL은 필요하지 않습니다. **처음 설치하면 선택 화면 없이 개인 PC용으로 시작합니다.** 로그인이나 API 키 입력이 필요하지 않으며, 백그라운드의 개인 작업실은 `127.0.0.1`에서만 실행됩니다. 같은 설치 명령으로 업데이트하면 기존 로컬/서버 연결과 게임 데이터를 유지합니다.

운영 중인 서버에 연결할 때만 설치 후 `tokenpet connect <서버 주소>`를 실행하고 웹에서 발급한 본인 회원 토큰을 입력하세요. 도메인/IP에 `https://`와 필요한 API 경로를 자동으로 붙이며 키 입력은 표시하지 않습니다. Windows에서는 키 파일에 현재 사용자와 SYSTEM만 접근할 수 있는 ACL을 적용합니다.

**MCP·`$pet`/`/pet` 명령·펫 표시·자동 연결까지 설치합니다.** 끝나면 평소처럼 `codex` 또는 `claude`를 실행하세요. 이미 실행 중인 CLI는 다시 시작해야 합니다. Claude에서는 `/pet help`, Codex에서는 `$pet help`를 입력하면 됩니다.

설치 위치는 macOS/Linux의 `~/.local/share/tokenpet/`, Windows의 `%LOCALAPPDATA%\TokenPet\`입니다. 관리 명령은 각각 `~/.local/bin/tokenpet`, `%LOCALAPPDATA%\TokenPet\bin\tokenpet.cmd`이며 사용자 PATH에 등록합니다. 새 터미널에서는 `tokenpet help`로도 사용할 수 있습니다. 기존 게임 데이터와 연결 설정은 사용자 홈의 `.tokenpet/`에 보관하며 업데이트해도 유지합니다. **업데이트는 같은 설치 명령을 다시 실행**하면 됩니다. 설치한 Node.js도 앱 전용 폴더에 있으므로 시스템 Node.js를 교체하지 않습니다. Linux 자동 Node 설치는 glibc 환경을 대상으로 합니다.

Windows는 등록된 MCP를 통해 로컬 서버를 시작합니다. npm으로 설치한 CLI와 공식 `.exe` 설치를 인식합니다. Claude 상태줄은 [공식 Windows 설정 방식](https://code.claude.com/docs/en/statusline#windows-configuration)에 따라 PowerShell로 실행합니다. 설치 후 이미 실행 중인 Claude·Codex는 다시 시작하세요.

설치 후 연결을 바꾸거나 복구하려면:

```sh
tokenpet connect                    # 로컬 / 서버 다시 선택
tokenpet connect pets.example.com   # 서버 연결 (접근 키 입력)
tokenpet connect local              # 기존 로컬 게임으로 복귀
tokenpet setup                      # CLI 연결 복구
tokenpet doctor                     # 현재 주소와 연결 상태 확인
tokenpet uninstall                  # 연결 해제와 프로그램 삭제 (--purge: 게임 데이터까지)
```

서버 연결은 도메인과 IP 모두 **HTTPS가 기본**입니다. IP만 사용하는 서버도 해당 IP에 유효한 인증서가 필요합니다. 사설 인증서를 쓰는 경우 아래 IP 연결 안내를 따르세요. 로컬·원격 게임은 별도로 보존하며 연결을 바꿀 때 데이터를 복사하거나 합치지 않습니다.

설치와 함께 연결을 명시적으로 바꾸려면 (`--local`은 기존 서버 연결에서 개인 작업실로 돌아갑니다):

```sh
curl -fsSL https://raw.githubusercontent.com/shariest/tokenpet/main/install.sh | bash -s -- --local
# 원격 자동 설치에서는 접근 키를 담은 파일을 지정합니다 (파일 권한 600).
curl -fsSL https://raw.githubusercontent.com/shariest/tokenpet/main/install.sh -o /tmp/tokenpet-install.sh
TOKENPET_API_KEY_FILE="$HOME/tokenpet-key" bash /tmp/tokenpet-install.sh --endpoint pets.example.com
```

Windows에서 설치와 함께 연결을 바꾸려면:

```powershell
Invoke-WebRequest -UseBasicParsing https://raw.githubusercontent.com/shariest/tokenpet/main/install.ps1 -OutFile "$env:TEMP\tokenpet-install.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$env:TEMP\tokenpet-install.ps1" -Local
# 서버 연결: -Local 대신 -Endpoint pets.example.com
# 자동화에서는 $env:TOKENPET_API_KEY_FILE에 서버 키 파일 경로를 지정합니다.
```

`-ExecutionPolicy Bypass`는 해당 설치 프로세스에만 적용하며 시스템 실행 정책을 바꾸지 않습니다. 회사에서 스크립트 실행을 별도로 제한한 PC는 조직 정책을 따릅니다.

Codex 대화창에서 **`$pet`**, Claude Code 대화창에서 **`/pet`**으로 시작하세요. 상태·돌봄·뽑기·전체 도감·검색·펫 선택·성장 규칙·활동 기록·사용량 수집 상태·이름 변경·공유·파일 저장을 대화창 안에서 처리합니다. **`$pet help` / `/pet help`**가 전체 명령 목록입니다.

웹 화면은 마우스 조작을 위한 선택 기능입니다 (`tokenpet open`, 기본 주소 **http://127.0.0.1:4780**). `tokenpet open dex` 또는 **http://127.0.0.1:4780/#dex**로 캐릭터 도감을 바로 열 수 있습니다. 미보유 펫도 실제 색상으로 표시하며, 캐릭터를 누르면 크게 볼 수 있습니다. 보유 펫의 미리보기에는 수면 상태와 돌봄 수치도 나옵니다. 미리보기는 펫을 교체하거나 코인을 사용하지 않습니다. 원격 연결은 설정한 서버 주소를 사용하며, 터미널에서 플레이할 때 웹을 열 필요는 없습니다.

백엔드·웹·CLI는 **TypeScript (`strict`)**, 실행 환경은 Node.js 24 이상입니다. 저장소는 SQLite가 기본이며, 서버에서는 PostgreSQL·MariaDB도 선택할 수 있습니다. `tsc`가 `dist/`에 JavaScript를 생성하며, Docker도 같은 빌드 결과를 사용합니다. `bin/tokenpet.mjs`는 CLI·MCP 진입 파일입니다. 설치 시 컴파일하고 개발 의존성을 제거해 실행에 필요한 패키지만 남깁니다.

저장소에서 개발할 때:

```sh
npm ci                  # 의존성 설치 + TypeScript 빌드
npm run build           # 소스 변경 후 다시 빌드
npm install --global .  # 현재 소스로 자동 연결 설치 (tokenpet 명령)
```

현재 정식 버전은 [`v1.0.0`](https://github.com/shariest/tokenpet/releases/tag/v1.0.0)입니다. 설치 명령은 `main`의 설치 프로그램을 사용하며, 프로그램 소스는 `v1.0.0` 태그로 고정합니다. 개발 브랜치는 [`develop`](https://github.com/shariest/tokenpet/tree/develop)이며, 검증한 개발 내용을 PR로 [`main`](https://github.com/shariest/tokenpet/tree/main)에 병합합니다. npm 레지스트리에는 배포하지 않았습니다.

## CLI 화면 안의 펫

**새 탭이나 분할 창 없이**, Claude는 자체 하단 상태줄에 픽셀 캐릭터를, Codex는 내장 펫 영역에 애니메이션 캐릭터를 표시합니다. 같은 백엔드를 쓰므로 지갑과 펫이 같습니다.

### Claude Code

평소처럼 `claude`를 실행하세요. 넓은 터미널에서는 오른쪽으로 정렬한 6줄 픽셀 펫 옆에 이름·레벨·코인·도감·0~100 돌봄 수치·필요한 돌봄 명령이 표시되고 2초마다 갱신됩니다. 기존 커스텀 상태줄이 있거나 터미널 높이가 낮아도 픽셀 캐릭터를 유지하며, 좁은 화면에서는 캐릭터 아래에 상태를 표시합니다. 기존 상태줄의 에이전트 정보·색상·입력 JSON을 보존합니다. 기존 상태줄이 있으면 갱신 주기를 최소 5초로 두고 더 긴 사용자 설정도 유지합니다. 펫 서버 조회는 최대 0.5초만 기다려 느린 서버가 기존 상태줄 갱신을 막지 않게 합니다. 전체 수치는 `/pet status`로 볼 수 있습니다. 기존 `padding`·Vim 표시 설정과 `subagentStatusLine`도 유지합니다. Claude 자체 도움말이나 권한 질문이 상태줄을 잠시 가릴 수 있습니다. `disableAllHooks` 설정은 Claude 상태줄도 비활성화합니다.

### Codex CLI

```sh
codex                          # 펫과 함께 평소대로 실행
codex resume <세션-ID>          # 기존 대화 이어서 실행
```

자동 연결이 웹과 동일한 픽셀 아트를 Codex 규격의 투명 PNG 애니메이션으로 내보냅니다. 설치 시 Codex의 공식 설정 API로 `tui.pet`을 저장하므로, 실행마다 설정 인자를 추가하지 않습니다. Codex 0.162에서 `-c`가 공유 백그라운드 서버를 비활성화하는 문제도 피합니다. 설치 프로그램이 기존 명령 경로에 자동 실행 연결을 등록하고 원본 CLI를 보존합니다. 인자·표준 입출력·종료 코드는 그대로 전달합니다. 비대화형 실행은 펫 준비를 건너뜁니다. 펫 연결에 실패해도 원래 CLI는 실행됩니다. 펫 파일은 `~/.codex/pets/tokenpet/`에 저장됩니다.

캐릭터 아래에는 **밥그릇(포만감)·하트(기분)·번개(에너지)·물방울(청결)** 순서로 막대와 0~100 수치가 표시됩니다. 상태판도 펫 이미지의 일부라 `/statusline` 설정 없이 보입니다. 30 미만인 수치는 붉게 표시합니다.

Codex 0.161–0.162는 Warp와 Orca의 이미지 지원을 자동 인식하지 못합니다. 대화형 Codex를 Warp 또는 **`TERM_PROGRAM=Orca`인 Orca**에서 실행하면, 자식 Codex에만 `TERM=xterm-kitty`, `TERM_PROGRAM=kitty`를 전달합니다. Orca는 `ORCA_IMAGE_PROTOCOL=kitty`이거나 힌트가 없을 때 적용하므로, 일반 SSH 셸에서 설치한 뒤 구버전 Orca 서버로 접속해도 별도 설정이 필요하지 않습니다. 출석 요청이 실패해도 적용하며 전역 셸 환경과 원본 CLI는 바꾸지 않습니다. Claude·비대화형 호출·도움말·버전 조회에는 적용하지 않습니다. 다른 터미널은 Codex가 지원하는 Kitty/Sixel 이미지 기능이 필요하며, tmux/Zellij 안에서는 내장 펫을 표시하지 못합니다.

Orca 앱은 **Inline Images가 켜져 있고 Kitty 이미지를 지원**해야 합니다. `ORCA_IMAGE_PROTOCOL=none codex`로 이미지 호환 처리를 끌 수 있으며, 빈 값이나 `sixel`처럼 명시한 다른 값도 유지합니다. 현재 터미널의 힌트가 설치 때 저장한 값보다 우선합니다. `ORCA_IMAGE_PROTOCOL=kitty tokenpet setup`으로 저장한 값은 힌트 없이 재설치·setup·connect를 실행하거나 CLI 업데이트 후 자동 연결을 복구해도 유지합니다. 기본값을 바꾸려면 `ORCA_IMAGE_PROTOCOL=none tokenpet setup`처럼 값을 명시하세요. 변경은 새 Codex 세션부터 적용하며, `TERM_PROGRAM_VERSION`만으로 PC의 Orca 앱 버전을 판단하지 않습니다.

Warp(macOS·Linux)에서는 Codex 세션마다 펫 이미지 번호를 분리합니다. 여러 탭의 Codex가 같은 번호의 이미지를 덮어쓰거나 지우면서 캐릭터와 상태창 전체가 깜빡이는 문제를 방지합니다. 애니메이션·돌봄·펫 교체 갱신은 유지하며, 시스템의 `/usr/bin/script`로 입력·창 크기 변경·종료 키를 전달합니다. 적용하려면 실행 중인 Codex를 한 번 재시작해야 합니다.

셸 재시작·설정 파일 편집·별도 실행 경로 지정은 필요하지 않습니다. 이미 실행 중인 CLI 프로세스에는 소급 적용되지 않으며, 다음 일반 `codex` 실행부터 적용됩니다. `$work-pets:pets`는 ChatGPT 앱의 펫 기능이며 이 게임의 `/pets tokenpet`·`$pet`과 별개입니다.

서버는 돌봄·펫 교체 직후와 상태 조회 시 Codex가 실제로 읽는 TokenPet 프레임까지 갱신합니다. Claude에서 교체해도 실행 중인 Codex에 반영되며 시간에 따른 변화는 10초마다 반영합니다. 원격 모드는 MCP가 연결된 동안 최대 10초 간격으로 갱신하며, 토큰 수집을 꺼도 이미지 동기화는 유지합니다. 캐릭터 오른쪽에 포만감·기분·에너지·청결 아이콘, 큰 숫자와 게이지가 표시됩니다. 애니메이션을 끈 세션은 Codex 화면이 다음에 다시 그려질 때 반영됩니다. `$pet status`로도 현재 수치를 확인할 수 있습니다.

Codex 0.161–0.162의 커스텀 펫 캐시 구조에 맞춰 TokenPet의 PNG·Sixel 프레임만 원자적으로 교체합니다. 다른 펫의 캐시에는 손대지 않습니다. 향후 Codex의 캐시 규격이 바뀌면 이 연동도 업데이트가 필요할 수 있습니다.

### 대화창 전용 명령

아래 명령은 **각 CLI의 대화 입력창**에 입력합니다. Claude는 공식 슬래시 스킬, Codex는 공식 `$` 스킬 호출을 사용합니다. 설치 시 자동 등록되며 명시적으로 호출할 때만 활성화합니다.

| 행동 | Claude Code | Codex CLI |
| --- | --- | --- |
| 상태 요약 | `/pet` 또는 `/pet status` | `$pet` 또는 `$pet status` |
| 캐릭터·상세 상태 | `/pet status --detail` | `$pet status --detail` |
| 출석 확인·보상 받기 | `/pet checkin` | `$pet checkin` |
| 밥 주기 | `/pet feed` | `$pet feed` |
| 놀기·씻기 | `/pet play`, `/pet clean` | `$pet play`, `$pet clean` |
| 자기·깨우기 | `/pet sleep`, `/pet wake` | `$pet sleep`, `$pet wake` |
| 가챠 | `/pet gacha <횟수>` (예: `3`, `25`) | `$pet gacha <횟수>` (예: `3`, `25`) |
| 보유 펫·수면 상태 | `/pet list [등급] [페이지]` | `$pet list [등급] [페이지]` |
| 전체 360종 도감 | `/pet catalog [등급] [페이지]` | `$pet catalog [등급] [페이지]` |
| 이름·ID 검색 | `/pet find "미오" [페이지]` | `$pet find "미오" [페이지]` |
| 펫 선택 | `/pet equip <id>` | `$pet equip <id>` |
| 돌봄 효과·성장·확률 | `/pet rules` | `$pet rules` |
| 활동 기록·사용량 수집 상태 | `/pet log` | `$pet log` |
| 작업실 이름 | `/pet name "내 작업실"` | `$pet name "내 작업실"` |
| 도감 공유 상태 확인 | `/pet share` | `$pet share` |
| 도감 공유 켜기·끄기 | `/pet share on` 또는 `off` | `$pet share on` 또는 `off` |
| 도감 HTML 파일 저장 | `/pet export ./my-dex.html` | `$pet export ./my-dex.html` |
| 도움말 | `/pet help` | `$pet help` |

대괄호 안의 인자는 생략할 수 있습니다. 등급은 `common`, `rare`, `epic`, `unique`, `legendary`이며 대화창 도감은 **10종씩** 표시합니다. 예: `$pet catalog rare 2`, `$pet dex 2`. 검색어에 공백이 있으면 따옴표로 감쌉니다. HTML 저장은 기존 파일을 덮어쓰지 않으며 공유를 자동으로 켜지 않습니다.

`list`는 보유 펫의 ID·레벨·보유 수량·현재 선택 여부·수면 상태를 짧게 보여줍니다. `list --detail`처럼 `status`, `list`, `dex`, `catalog`, `find` 끝에 **`--detail`**을 붙이면 픽셀 그림과 돌봄 수치를 볼 수 있습니다. 도감의 페이지와 필터는 그대로 유지됩니다. 결과 끝의 웹 링크에서는 컬러 원본을 크게 볼 수 있습니다. 직접 실행하는 `tokenpet list`는 컬러 썸네일을 24종씩 표시합니다 (`NO_COLOR` 환경에서는 흑백). `dex`도 같은 명령입니다. **한 펫을 재워 둔 채 다른 펫을 키울 수 있습니다.** Codex에서는 다음 순서로 입력하세요. Claude에서는 `$pet` 대신 `/pet`을 사용합니다.

```text
$pet sleep
$pet list
$pet equip <목록에 나온 다른 펫의 ID>
```

교대는 무료이고 각 펫의 수면·돌봄 수치는 유지됩니다. **현재 선택한 펫만** 시간당 포만감 -2·행복 -1·청결 -1.5, 깨어 있으면 에너지 -2가 적용됩니다. **선택하지 않은 펫은 포만감·행복·청결을 유지**하며, 깨어 있으면 에너지 +2/시간으로 회복합니다. 잠든 펫은 선택 여부와 관계없이 에너지 +20/시간으로 회복합니다. CLI를 꺼둔 시간도 반영하며, 교대 시 두 펫의 상태를 저장해 활동·대기 시간을 정확히 나눕니다. 코딩 경험치는 현재 선택한 펫에게 쌓이고 코인은 공유합니다. 잠든 펫으로 돌아왔을 때는 `wake`로 깨운 뒤 돌보세요. Codex 내장 이미지도 자동으로 바뀝니다.

`$pet` / `/pet`은 이름·레벨·포만감·기분·에너지·청결(0~100)·경험치·잔액·출석을 요약합니다. 돌봄이 필요하면 해당 명령을 제안하고, `status --detail`에서는 그림·게이지·상세 성장 안내를 함께 표시합니다. 밥을 주면 전체 상태를 반복하지 않고 `포만감 0→25 (+25) · 기분 0→5 (+5) · 경험치 +10 · 5 C 사용`처럼 실제 변화와 잔액만 반환합니다. 수치가 100에 가까우면 실제로 회복된 양만 표시합니다.

MCP 응답을 줄이기 위해 뽑기 결과는 등급별 횟수·신규/중복·천장·사용 코인·잔액을 요약하고, 같은 펫은 합쳐 **최대 10종**만 보여줍니다. 높은 등급과 같은 등급의 신규 펫을 먼저 표시하며, 생략한 종류 수를 알립니다. 뽑는 횟수와 실제 지급은 바뀌지 않습니다. `log`는 최근 5건을 짧게, `log --detail`은 최근 20건을 전체 내용으로 보여줍니다. Claude 상태줄·Codex 내장 펫·웹 화면은 계속 그림으로 표시합니다. 모델의 전체 입출력 토큰 상한을 설정하는 기능은 아니며, 게임 도구와 스킬이 전달하는 텍스트를 줄이는 방식입니다.

터미널에서 직접 실행하는 명령은 `tokenpet help`를 사용합니다.

전용 명령은 해당 게임 MCP 도구만 호출하고 결과를 짧게 보여줍니다. 알 수 없는 명령·잘못된 횟수는 사용법만 표시하며 코인을 사용하지 않도록 지시합니다. 이 경로는 CLI 모델이 스킬을 해석하므로 일반 CLI 사용량이 발생합니다. 모델 없이 돌보려면 아래 `tokenpet feed` 같은 터미널 명령이나 웹 작업실을 사용하세요. CLI 상태줄·내장 펫 이미지에는 마우스 버튼이 없습니다.

### 독립 터미널 화면

`tokenpet ui`는 CLI를 사용하지 않는 동안 키보드로 돌보는 별도 전체 화면입니다.

| TUI 키 | 행동 |
| --- | --- |
| `f` | 밥, 5코인 |
| `p` | 놀기, 무료·에너지 10 |
| `c` | 씻기, 3코인 |
| `s` | 잠들기 / 깨우기 |
| `g` | 1회 가챠, 100코인 |
| `d` | 보유 친구 확인 |
| `q`, `Ctrl+C` | 터미널 펫 닫기 |

웹과 터미널은 **같은 픽셀 데이터**로 캐릭터를 그립니다. True Color ANSI 터미널에서는 반쪽 블록으로 컬러 스프라이트를, 비대화형 출력이나 `NO_COLOR=1`에서는 문자 그림을 사용합니다. TUI는 32열 × 34행 이상을 권장합니다.

## CLI / MCP

```sh
tokenpet status
tokenpet feed
tokenpet play
tokenpet clean
tokenpet sleep
tokenpet wake
tokenpet gacha 1
tokenpet gacha 10
tokenpet gacha 25             # 전체 2,500코인이 없으면 한 번도 뽑지 않음
tokenpet list                  # 보유 펫·수면·돌봄 상태 (dex도 같은 명령)
tokenpet list rare 2           # 등급과 페이지는 생략 가능
tokenpet equip forest-cat      # 먼저 해당 펫을 보유해야 합니다
tokenpet name "모카의 작업실"
tokenpet share                 # 공유를 명시적으로 켜고 링크 출력
tokenpet share off             # 기존 링크 즉시 폐기
tokenpet export ./my-dex.html  # 단독으로 열리는 HTML, 기존 파일은 덮어쓰지 않음
tokenpet doctor
```

MCP 도구는 `pet_status`, `pet_checkin`, `pet_care`, `pet_gacha`, `pet_dex`, `pet_equip`, `pet_name`, `pet_share`, `pet_export`입니다. `pet_status`의 `view`로 상태·규칙·기록을 조회하고, `pet_dex`의 `all`·`tier`·`query`·`page`로 도감을 탐색합니다. 두 조회 도구는 `detail:true`로 상세 응답을 요청할 수 있습니다. 가챠·공유·내보내기는 사용자가 요청했을 때 실행하도록 도구에 명시했습니다. CLI 전용 스킬에는 Claude의 `disable-model-invocation: true`, Codex의 `allow_implicit_invocation: false`를 적용합니다. 전용 명령과 일반 개발 대화를 분리하며 사용자 CLI의 기존 도구 권한 정책은 유지합니다.

설치는 `claude mcp add --scope user --transport stdio`와 `codex mcp add` 공식 명령을 사용합니다. 이 앱의 설치 경로가 바뀌면 기존 연결도 갱신합니다. 같은 이름의 다른 MCP나 명령 파일이 있으면 덮어쓸지 묻고, 동의하면 백업한 뒤 바꿉니다. 거절하면 그 항목만 건너뛰고 나머지 설치를 계속합니다. 터미널 없이 자동 설치할 때는 `TOKENPET_OVERWRITE=1`로 덮어쓸 수 있습니다. 기존 Claude 상태줄 명령은 입력을 그대로 전달받아 먼저 실행되고 펫 표시가 이어집니다. MCP 상태 조회는 기본적으로 텍스트 요약을 반환하며 `detail:true`일 때 문자 캐릭터도 반환합니다. 기존 `notify`/hook 설정은 변경하지 않습니다.

설정 백업은 `~/.tokenpet/backups/<timestamp>/`, 이전 상태줄은 `previous-statusline.json`입니다. macOS/Linux에서는 자동 실행 연결 목록을 `cli-launchers.json`에 저장합니다. 설치 당시 `PATH`에 있는 사용자 소유의 `codex`·`claude` 명령 경로를 연결하므로, 기존 셸의 명령 캐시에도 적용됩니다. npm·기본 설치의 심볼릭 링크는 원본 옆의 실행 연결 파일을 가리키며 원본 파일은 유지합니다. 단일 실행 파일 설치는 같은 디렉터리의 `.tokenpet-original-<명령>`에 원본을 보존합니다. Windows에서는 원래 CLI 실행 파일을 그대로 사용하고 등록된 MCP가 서버를 시작합니다.

셸 alias/function이 별도 실행 파일을 직접 호출하면 셸 우선순위가 적용됩니다. 시스템 소유이거나 쓰기 권한이 없는 CLI·원본·런처 경로는 경고와 함께 건너뛰고, 나머지 사용자 CLI 연결을 계속합니다. npm 링크가 가리키는 패키지 디렉터리도 쓰기 가능해야 합니다. 경고가 나오면 사용자 소유의 쓰기 가능한 CLI를 `PATH` 앞에 추가한 뒤 `tokenpet setup`을 다시 실행하세요. CLI 업데이트가 명령 링크를 교체하면 실행 중인 로컬 서버가 10초 안에 연결을 복구합니다. 서버가 꺼진 동안 CLI를 업데이트했거나 새로운 CLI 경로를 추가했다면 `tokenpet setup`으로 다시 연결할 수 있습니다. 서버 로그는 `~/.tokenpet/server.log`입니다.

전용 명령은 Claude의 `~/.claude/commands/pet.md`, Codex의 `~/.codex/skills/pet/`에 설치됩니다. Codex가 Claude 스킬 폴더도 읽으므로 Claude는 명령 파일을 사용해 중복 노출을 피합니다.

**삭제는 `tokenpet uninstall` 한 줄**입니다. 로컬 서버를 멈추고 MCP 연결·Claude 상태줄·`codex`/`claude` 자동 실행 연결·전용 명령·Codex 펫 설정을 설치 전으로 되돌린 뒤 프로그램 폴더를 지웁니다. 설치할 때 사용한 Claude·Codex 설정 폴더(`CLAUDE_CONFIG_DIR`·`CODEX_HOME`)를 기록해 두므로, 다른 셸에서 실행해도 그 위치까지 정리합니다. 게임 데이터(`~/.tokenpet`)는 남겨 두어 다시 설치하면 이어서 키울 수 있고, `tokenpet uninstall --purge`는 데이터까지 지웁니다. 실행 중인 Claude·Codex는 다시 시작하세요. 셸 설정에 추가한 `PATH` 줄은 다른 도구와 함께 쓰일 수 있어 남겨 둡니다. npm으로 설치했다면 마지막에 `npm rm -g tokenpet`을 실행하세요.

## 재화와 레벨 디자인

**Claude와 Codex는 각각 보상하고 합산합니다.** 같은 키의 이벤트라도 서로 다른 제공자이면 별개로 계산합니다. 한 CLI의 같은 기록을 재전송하거나 서버를 재시작했을 때만 중복 지급을 방지합니다.

| 항목 | 규칙 |
| --- | --- |
| 가입 선물 | 300코인 + 일반 가챠와 같은 등급 확률의 무료 랜덤 펫 1마리 |
| 환율 | 집계 토큰 10,000개 = 1코인, 나머지 이월 |
| 가챠 | 1회 100코인 × 요청 횟수 (1 이상의 정수, 생략 시 1회). 전체 비용이 부족하면 추첨·차감 없음 |
| 사용량 예시 | 100만 집계 토큰 → 100코인 → 1회 / 2억 토큰 → 2만 코인 → 200회 |
| 동시 사용 | Claude 100만 + Codex 100만 → 200코인 → 2회 |
| 자동 출석 | 기본 100코인, 연속 하루마다 +20코인, 7일째부터 매일 220코인 |
| 기본 확률 | 커먼 78.9%, 레어 15%, 에픽 5%, 유니크 1%, 레전더리 0.1% |
| 천장 | 유니크 50회·레전더리 100회 각각 집계. 해당 등급 획득 시 그 카운트만 초기화. 동시에 도달하면 레전더리 먼저, 다음 뽑기 유니크 |
| 중복 | 정상적으로 출현. 해당 종의 수량 +1, 경험치 +25 |
| 성장 | 집계 토큰 20,000개마다 활성 펫 +1 XP, 돌봄 +10 XP. 출석 코인은 XP 지급 대상이 아님 |
| 레벨 | `min(50, 1 + floor(sqrt(XP / 25)))` |
| 진화 | Lv.5 청소년, Lv.10 성체 및 왕관 표시. 등급은 유지 |

두 천장 카운트는 재시작과 여러 회 묶음 뽑기에서도 이어집니다.

첫 펫은 신규 작업실 생성 시 `crypto.randomInt()`로 한 번 추첨하고 바로 선택합니다. 커먼 78.9%·레어 15%·에픽 5%·유니크 1%·레전더리 0.1%이며 등급 내 각 펫의 확률은 같습니다. 가입 코인 300개를 차감하지 않고, 유료 뽑기 횟수와 천장 카운트는 0에서 시작합니다. 결과는 작업실·보유 펫·가입 기록과 함께 한 트랜잭션으로 저장하므로 재시작·업데이트·다른 CLI 연결로 다시 뽑히지 않습니다.

`gacha N`은 1·10회에 제한되지 않습니다. 예를 들어 잔액 2,400코인에서 `gacha 25`를 요청하면 **0회 추첨, 0코인 차감**으로 중지합니다. 가능한 24회만 대신 뽑지 않습니다. 전체 비용을 먼저 확인하고 N회를 한 트랜잭션으로 처리하므로, 도중에 오류가 나도 코인·펫 수량·경험치·천장·기록을 모두 되돌립니다. Claude/Codex도 요청한 횟수를 한 번의 도구 호출로 전달하며, 여러 작은 요청으로 쪼개지 않습니다. 천장은 요청 내에서 매 회 순서대로 계산합니다. 0·음수·소수·정확히 표현할 수 없는 큰 수는 거부합니다.

환율은 실제 API 가격이나 요금제 한도와 무관한 게임 규칙이며, 사용량 보상에는 일일 상한이 없습니다. 코인과 XP의 **미정산 토큰을 따로 저장**해 다음 사용량과 합쳐 정산합니다. 과거 기록 재전송·재시작만으로는 추가 지급하지 않습니다.

### 매일 자동 출석

설치한 `claude` / `codex`의 대화 세션을 시작하면 런처와 MCP 연결이 오늘 출석을 확인합니다. `tokenpet ui`를 열어도 출석합니다. **같은 작업실은 여러 CLI·기기·세션을 열어도 한국 시간(Asia/Seoul) 하루 한 번만 지급**합니다. 서버가 Docker에서 UTC로 실행되어도 기준은 한국 시간 00시입니다. 서버의 시계를 사용하며 클라이언트가 보낸 날짜나 보상 금액은 사용하지 않습니다.

| 연속 출석 | 1일 | 2일 | 3일 | 4일 | 5일 | 6일 | 7일 이후 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 매일 받는 코인 | 100 | 120 | 140 | 160 | 180 | 200 | 220 |

첫 7일 합계는 **1,120코인**입니다. 하루를 빠뜨리면 다음 출석은 1일차 100코인부터 시작하고, 7일 이후에는 매일 220코인을 유지합니다. 출석은 공용 지갑에 코인만 지급하며 펫의 수면·돌봄·선택·XP를 바꾸지 않습니다. 출석 기록과 지갑 갱신을 하나의 트랜잭션으로 처리해 동시 접속과 재시도에도 중복 지급하지 않습니다.

`$pet status` / `/pet status`에 오늘 받은 코인·연속 일수·내일 받을 코인이 나옵니다. 연결에 실패했거나 자정을 넘겨 같은 세션을 계속 사용한다면 `$pet checkin` / `/pet checkin` 또는 셸의 `tokenpet checkin`으로 받을 수 있습니다. 웹 작업실에도 출석 현황과 받기 버튼이 있습니다. 백그라운드 서버·사용량 폴링·단순 상태 조회는 출석을 자동 지급하지 않습니다. 네트워크 오류 때문에 받지 못한 날은 다음 접속 시 과거 날짜로 소급 지급하지 않습니다.

### 추가 코인 수급 아이디어

아래 항목은 다음 기능을 위한 제안이며 현재 자동 지급하지 않습니다. 모델 호출량이나 반복 클릭을 강요하지 않는 보상부터 추가할 수 있습니다.

| 제안 | 지급 조건과 보상 | 반복 수급 제한 |
| --- | --- | --- |
| 일일 돌봄 미션 | 밥·놀이·청소를 각각 1번 하면 50코인 | 작업실당 하루 1회, 비용 차감 후 완료 시 지급 |
| 주간 출석 목표 | 한 주에 5일 출석하면 500코인 추가 | 한국 시간 월~일 기준 주 1회, 연속일 필요 없음 |
| 도감 수집 업적 | 서로 다른 펫 10·25·50·100종을 만나면 200·500·1,000·2,000코인 | 목표별 최초 1회, 중복 펫은 종수에서 제외 |
| 성장 업적 | 각 펫이 Lv.5·10·25에 도달하면 50·100·200코인 | 펫 종·단계별 최초 1회, 선택을 바꿔도 재지급하지 않음 |

360종은 **36개 종족 × 10개 서식지 변종**입니다. 종족별 실루엣과 서식지별 색·장식을 조합하며, 테스트에서 360개 픽셀 결과가 모두 다름을 확인합니다. 커먼 108종, 레어 108종, 에픽 72종, 유니크 36종, 레전더리 36종. 등급 내 개별 종 확률은 같습니다. 모든 종족은 `src/catalog.ts`, 그림은 `public/pet-art.ts`에서 관리합니다.

포만감·청결·행복은 선택한 펫만 시간에 따라 줄어듭니다. 에너지는 선택한 펫이 깨어 있으면 -2/시간, 대기 중 깨어 있으면 +2/시간, 잠들면 선택 여부와 관계없이 +20/시간입니다. CLI를 꺼둔 시간도 반영합니다. 방치해도 죽거나 도감에서 사라지지 않습니다. 같은 돌봄에는 30초 재사용 시간이 있고 잠들기/깨우기로 경험치를 반복 획득할 수 없습니다.

## 사용량 연동 규격

CLI 화면 연동 확인일 **2026-10-12**, 로컬 검증 버전 **Claude Code 2.1.296 / codex-cli 0.161.0 및 0.162.1**, MCP SDK **2.3.1**.

```mermaid
flowchart LR
  C[Claude JSONL] --> R[로컬 사용량 수집기]
  X[Codex JSONL] --> R
  R -->|해시 ID와 토큰 숫자| B[HTTP API + SQLite / PostgreSQL / MariaDB]
  M[두 CLI의 stdio MCP] --> B
  T[터미널 픽셀 펫] --> B
  W[마우스 작업실] --> B
  B --> S[읽기 전용 공유 도감]
```

| 제공자 | 기록 | 정산 |
| --- | --- | --- |
| Claude | `~/.claude/projects/**/*.jsonl`, 서브에이전트 포함 | `assistant.message.id` 기준. input + cache_creation + cache_read + output |
| Codex | `~/.codex/sessions/**/*.jsonl`, `archived_sessions` | `session_meta.payload.id`, `event_msg/token_count.info.total_token_usage` 누적 input + output |

Claude의 반복 메시지/블록은 메시지 ID별 최고 사용량으로 합칩니다. Codex input에는 캐시, output에는 reasoning이 이미 포함되므로 별도로 더하지 않습니다. Codex 누적 카운터가 내려가면 음수 정산하지 않고 이전 최고점을 유지합니다. 프로세스 재시작·전송 실패·복사된 로그는 다시 읽어도 원장이 중복 지급하지 않습니다. 쓰는 중인 JSONL 마지막 줄은 완성된 다음 읽습니다. 8MiB가 넘는 단일 줄은 메모리를 보호하기 위해 건너뜁니다.

처음 서버를 만든 시각 이전 기록은 **기준점만 저장**합니다. 설치 이전 사용량으로 코인을 소급 지급하지 않습니다. 로그는 읽기 전용이고, 서버에는 제공자·해시 ID·input/output 숫자·기준점 여부만 전달합니다. 프롬프트, 소스, 도구 결과, API 키는 보내지 않습니다. 초기 기록 확인에는 파일 크기에 따라 시간이 걸릴 수 있습니다.

**내부 JSONL 형식은 공식 안정 API가 아닙니다.** 두 CLI 업그레이드 시 어댑터 테스트와 실제 기록 스키마를 다시 확인해야 합니다. 공식 Codex `exec --json`의 `turn.completed.usage`도 검토했지만, 대화형 CLI와 기존 로그를 동시에 지원하기 위해 수집기는 세션 기록을 사용합니다. 별도의 LLM 호출이나 유료 API 호출은 하지 않습니다.

검토한 공식 규격:

- [Claude Code MCP](https://code.claude.com/docs/en/mcp)
- [Claude Code 상태줄](https://code.claude.com/docs/en/statusline) — 여러 줄 ANSI 출력, `COLUMNS`, `refreshInterval` 사용.
- [Claude Code 슬래시 스킬](https://code.claude.com/docs/en/skills) / [Codex 명시적 스킬 호출](https://learn.chatgpt.com/docs/build-skills)
- [Codex 내장 펫](https://learn.chatgpt.com/docs/pets) / [0.161.0 커스텀 펫 파일 규격](https://github.com/openai/codex/blob/rust-v0.161.0/codex-rs/tui/src/pets/model.rs)
- [Warp 이미지 프로토콜](https://docs.warp.dev/terminal/more-features/files-and-links)
- [Claude Code hooks와 transcript_path](https://code.claude.com/docs/en/hooks) — hook이 호출되어야만 보상되는 제약을 피하려고 독립 수집기를 사용합니다.
- [Codex MCP / stdio 설정](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
- [Codex 비대화형 JSON 이벤트](https://learn.chatgpt.com/docs/non-interactive-mode)
- [Codex 설정: notify 및 MCP](https://learn.chatgpt.com/docs/config-file/config-reference)
- [Anthropic Max 플랜과 한도](https://support.claude.com/en/articles/11049741-what-is-the-max-plan)
- [공식 MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk)

## 회원·랭킹·공개 도감

회원·랭킹·공개 도감은 서버 모드에서 제공합니다. 개인 PC용에서는 회원가입·로그인·토큰 발급·랭킹 화면과 API를 제공하지 않습니다.

1. 서버 웹 화면에서 **회원가입**을 선택합니다. 아이디(영문·숫자·밑줄 3~32자), 비밀번호(12~128자), 공개 닉네임(1~20자)을 입력합니다. 아이디는 대소문자를 구분하지 않습니다.
2. **CLI 연동 → 연결 토큰 발급**에서 30·90·365일 중 유효 기간을 선택합니다. 원문 토큰은 발급 직후 한 번만 표시합니다.
3. 개발 컴퓨터에서 `tokenpet connect pets.example.com`을 실행하고 토큰을 접근 키 입력란에 붙여 넣습니다. 같은 회원의 Claude·Codex·여러 컴퓨터가 한 작업실을 사용합니다.

**회원당 연결 토큰은 하나뿐입니다.** 재발급이 성공하면 기존 토큰을 즉시 폐기하고 새 토큰으로 교체합니다. 재발급에 실패하면 기존 토큰이 유지됩니다. 연결된 모든 CLI에서 `tokenpet connect`로 새 토큰을 입력해야 합니다. 수동 폐기·만료 후에도 게임 기록은 보존됩니다. 토큰은 비밀번호처럼 보관하고 셸 명령 인자나 채팅에 넣지 마세요.

- **친구 도감:** 비로그인 상태에서도 360종의 실제 모습·등급·검색·페이지 탐색·확대 보기를 이용합니다. 로그인하면 **내가 보유한 친구** 필터와 펫 선택이 열립니다.
- **성장 랭킹:** 회원이 보유한 펫 중 최고 레벨 한 마리로 비교합니다. 레벨은 XP에서 계산하며 동률은 XP → 종류 수 → 가입 순입니다.
- **수집 랭킹:** 서로 다른 펫의 종류 수로 비교합니다. 중복 수량은 보조 정보로만 표시하며 동률은 최고 XP → 가입 순입니다.
- **내 순위:** 로그인하면 현재 페이지와 상관없이 별도로 표시합니다. 랭킹은 20명씩 조회합니다.

랭킹에는 가입한 회원의 닉네임·대표 펫·레벨/XP·수집 종류 수·총 보유 수량만 공개합니다. 아이디·코인·사용량·활동 기록·토큰은 공개하지 않습니다. 공유 도감은 랭킹과 별도로 켜고 끌 수 있습니다. 로컬 전용 작업실은 랭킹에 포함하지 않습니다.

이메일과 외부 인증을 사용하지 않으므로 **비밀번호 찾기는 제공하지 않습니다.** 비밀번호 관리자에 저장해 주세요. 회원 작업실과 로컬 작업실은 독립적이며 가입 시 자동 병합하지 않습니다.

## 백엔드와 공유

Node HTTP + SQLite(WAL), 또는 외부 PostgreSQL·MariaDB. 코인 차감·펫 지급·천장 갱신은 한 트랜잭션에 저장하고, 변경 요청은 `Idempotency-Key`를 사용합니다. 전체 도감·랭킹·켜둔 공유 도감·health·정적 화면은 공개하고 게임 데이터와 변경 API는 인증이 필요합니다. CLI는 회원 토큰을 `X-API-Key` 하나로 전달하고 브라우저는 HttpOnly/SameSite=Strict 쿠키를 사용합니다. 세션은 30일 후 만료하며 로그아웃 시 서버에서도 폐기합니다. HTTPS에서는 Secure 쿠키를 설정합니다. Host/Origin 검증, JSON 본문 제한, 아이디/연결 주소별 로그인·가입 제한을 적용했습니다. 비밀번호는 salt를 붙인 scrypt(N=32768, r=8, p=3), 세션과 토큰은 SHA-256 해시로 저장합니다. 비밀번호 해시 계산은 동시에 두 건으로 제한합니다. [OWASP의 scrypt 권장 설정](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt)을 사용합니다.

DB 파일은 기본적으로 `~/.tokenpet/game.sqlite`이며 Node의 `node:sqlite`로 접근합니다. 별도의 DB 서버 설치는 필요하지 않습니다. 모든 회원을 하나의 DB에 저장하고 펫·지갑·사용량·보상 잔여분·출석·돌봄·뽑기 요청을 회원 ID로 분리합니다. 서버가 인증에서 회원을 결정하므로 클라이언트가 다른 회원 ID를 보내도 다른 작업실에 접근할 수 없습니다.

로컬 실행은 개인 작업실에 자동으로 연결합니다. Docker/공개 서버는 방문자를 로그인시키지 않고 공개 도감과 랭킹부터 보여줍니다. 서버의 `api-key`는 로컬 작업실(플레이어 1) 전용이며 회원용으로 배포하지 않습니다. 로컬 사용량 파일은 사용자가 수정할 수 있어 랭킹은 자체 보고된 사용량에 기반한 커뮤니티 기록입니다. 부정행위가 차단된 공식 경쟁 순위나 결제 증명이 아닙니다.

| API | 용도 |
| --- | --- |
| `POST /api/signup` | `{ "username": "alice", "password": "…", "nickname": "앨리스" }`, 가입 후 로그인 |
| `POST /api/login` | 아이디·비밀번호 로그인 |
| `GET /api/me` | 로그인 상태·내 회원 정보, 비로그인도 조회 가능 |
| `DELETE /api/session` | 브라우저 세션 폐기·로그아웃 |
| `GET /api/tokens` | 현재 토큰의 식별값·만료일·최근 사용일, 원문 제외 |
| `POST /api/tokens` | `{ "days": 90 }`, 발급/재발급 시 기존 토큰 자동 폐기 |
| `DELETE /api/tokens/:id` | 내 토큰 폐기 |
| `GET /api/catalog` | 전체 도감, `?owned=true`는 인증 필수, `tier`·`q` 검색 지원 |
| `GET /api/rankings` | `?type=level` 또는 `collection`, `page`는 1부터 |
| `GET /api/state` | 펫·지갑·도감·연동 상태 |
| `POST /api/care` | `{ "action": "feed" }` 등 |
| `POST /api/gacha` | `{ "count": 25 }` — 1 이상의 정수, 전체 비용 부족 시 409 및 변경 없음 |
| `POST /api/equip` | `{ "id": "forest-cat" }` |
| `POST /api/profile` | `{ "name": "내 작업실" }` |
| `POST /api/usage` | 정규화된 누적 사용량, 인증 필요 |
| `POST /api/share` | `{ "enabled": true }` / false |
| `GET /api/share/:slug` | 공개 읽기 전용 도감 |

토큰 관리 API는 회원의 브라우저 세션으로만 이용합니다. CLI 토큰으로 다른 토큰을 발급할 수 없습니다. API 키와 쿠키를 동시에 보내면 거부합니다. 게임 변경 API에는 `Idempotency-Key`가 필요하고 사용량은 회원·제공자·기록 ID별 누적값으로 중복을 막습니다.

공개 회원 서버의 변경 요청은 회원당 분당 120회, 한 번의 뽑기는 최대 1,000회로 제한합니다. 초과 뽑기는 차감 없이 거부합니다. 자체 보고한 사용량으로 큰 잔액을 만든 뒤 한 요청으로 서버를 오래 점유하는 일을 막기 위한 제한이며, 로컬 작업실에는 적용하지 않습니다.

공유는 기본 꺼짐입니다. 켜면 링크를 아는 사람이 도감 이름·펫·레벨·보유 수량을 볼 수 있습니다. 지갑·돌봄 기록·사용량은 공개하지 않습니다. 끄면 링크를 즉시 폐기합니다. `tokenpet export`는 서버가 없어도 열리는 독립 HTML을 만듭니다.

## Docker 서버

**이 절은 회원 서버 운영자용입니다. 일반 개인 PC 설치에는 Docker가 필요하지 않습니다.** Dockerfile 하나로 웹 프런트엔드와 API 백엔드를 함께 빌드·서빙합니다. 정적 ES 모듈 프런트엔드라 별도 번들러·Node 프런트엔드 서버·프런트엔드 이미지가 필요하지 않습니다. Node 24 이미지에서 일반 사용자로 실행합니다. 기본값은 `/data` 볼륨의 SQLite이며, 외부 DB는 환경 변수로 연결합니다.

소스가 있는 폴더에서 **설정 파일 없이** 실행합니다.

```sh
docker compose up -d --build
```

**http://localhost:4780**에서 회원가입·도감·랭킹을 이용합니다. `.env`, DB 설치, 도메인 없이 시작하며 SQLite 파일은 프로젝트별로 자동 생성되는 Docker `game` 볼륨의 `/data/game.sqlite`에 저장됩니다. 재시작·컨테이너 교체에도 데이터가 유지됩니다. 개인 PC용 CLI의 `~/.tokenpet` 데이터와는 별도입니다.

같은 컴퓨터에서 개인 PC용 TokenPet이 4780을 쓰고 있다면 `.env`에 `TOKENPET_PORT=4880` 한 줄을 넣고 같은 명령을 실행하세요. 접속 주소는 **http://localhost:4880**이 됩니다.

Compose 없이 이미지 하나로도 실행할 수 있습니다.

```sh
docker build -t tokenpet .
docker run -d --name tokenpet -p 127.0.0.1:4780:4780 \
  -v tokenpet-data:/data tokenpet
```

### HTTPS로 공개하기

로컬 HTTP는 loopback 주소만 허용합니다. 외부에 공개할 때는 별도 HTTPS 설정으로 **동일한 앱 이미지** 앞에 Caddy를 추가합니다. 공개 서버용 소스를 Git 없이 받으려면:

```sh
mkdir tokenpet-server
cd tokenpet-server
curl -fsSL https://codeload.github.com/shariest/tokenpet/tar.gz/refs/heads/main | tar -xz --strip-components=1
cp .env.example .env
cp compose.https.yaml compose.override.yaml
```

이미 소스가 있다면 마지막 두 복사 명령만 실행합니다. 기존 `.env`나 `compose.override.yaml`이 있으면 덮어쓰지 말고 필요한 설정을 합치세요. `.env`에 `TOKENPET_ADDRESS=pets.example.com`을 실제 **도메인 또는 IP**로 설정합니다. 도메인을 쓴다면 DNS의 A/AAAA 레코드를 서버로 연결하고 외부에서 **80·443 포트**에 접근할 수 있게 합니다.

```sh
docker compose up -d --build
docker compose ps
```

게임 서버와 [Caddy HTTPS 프록시](https://caddyserver.com/docs/automatic-https)가 함께 실행됩니다. Compose가 `compose.override.yaml`을 자동 적용하며, [포트 초기화 설정](https://docs.docker.com/reference/compose-file/merge/#reset-value)으로 앱의 localhost 포트를 닫습니다. 외부에는 프록시의 80·443 포트만 열립니다. Docker Compose 최신 버전을 사용하세요. 기본 SQLite DB와 접근 키, 인증서는 Docker 볼륨에 저장됩니다.

각 사용자는 서버 웹 화면에서 회원가입하고 **CLI 연동**에서 자신의 토큰을 발급받습니다. `/data/api-key`는 로컬 작업실(플레이어 1) 전용 키이므로 회원에게 나눠주지 않습니다.

클라이언트에는 도메인/IP만 입력합니다. 예를 들어 `pets.example.com`을 입력하면 상태 조회는 `https://pets.example.com/api/state`, 돌봄은 `/api/care`로 자동 연결됩니다. 잘못된 키나 응답을 받으면 기존 연결 설정은 바꾸지 않습니다. 키는 `~/.tokenpet/connection.json`에 현재 사용자만 읽을 수 있는 권한(600)으로 저장합니다. 게임 키는 Claude/OpenAI API 키와 별개입니다.

### 기존 PostgreSQL·MariaDB 연결

DB 서버를 새로 띄울 필요 없이 **기존 PostgreSQL 16+ 또는 MariaDB 10.11+**에 연결할 수 있습니다. 데이터베이스와 앱 전용 DB 계정은 운영자가 준비하고, `.env`의 `TOKENPET_DATABASE_URL`에 아래 둘 중 하나만 설정하면 됩니다. 풀 설정은 생략해도 됩니다. 비밀번호의 `@`, `:`, `/`, `#`, `%`, `$` 등은 URL 인코딩합니다.

```dotenv
# PostgreSQL
TOKENPET_DATABASE_URL=postgres://tokenpet:URL_ENCODED_PASSWORD@db.example.com:5432/existing_db?sslmode=verify-full
# MariaDB를 쓸 때는 위 값 대신 아래 값을 사용
# TOKENPET_DATABASE_URL=mariadb://tokenpet:URL_ENCODED_PASSWORD@db.example.com:3306/existing_db?ssl=true

# 아래는 선택 사항이며 생략 시 기본값을 사용합니다.
TOKENPET_DB_NAMESPACE=tokenpet
TOKENPET_DB_POOL_MAX=30
TOKENPET_DB_POOL_MIN=5
TOKENPET_DB_CONNECT_TIMEOUT_MS=10000
TOKENPET_DB_IDLE_TIMEOUT_MS=30000
```

```sh
chmod 600 .env
docker compose up -d --build
docker compose ps
```

직접 `docker run`으로 띄울 때는 `--env-file .env`를 추가하면 됩니다. Compose에는 DB 컨테이너를 추가하지 않습니다. 접속 대상에는 DB 서버의 DNS/IP 또는 같은 Docker 네트워크의 서비스 이름을 사용하세요. **컨테이너 안의 `localhost`는 컨테이너 자신**입니다. Docker Desktop 호스트의 DB는 `host.docker.internal`로 연결할 수 있으며, Linux에서는 필요하면 앱 서비스에 `extra_hosts: ["host.docker.internal:host-gateway"]`를 추가합니다. DB의 접근 허용 설정도 앱 컨테이너가 접속할 수 있어야 합니다.

- PostgreSQL: 지정 DB의 `tokenpet` 스키마에 테이블을 만듭니다. 계정에 DB `CONNECT`, 스키마 생성 권한이 필요합니다. DBA가 `CREATE SCHEMA tokenpet AUTHORIZATION 앱계정;`으로 미리 만들었다면 해당 스키마의 `USAGE`·`CREATE`와 앱 테이블·시퀀스 권한으로 운영할 수 있습니다.
- MariaDB: 지정 DB 안에 `tokenpet_player`, `tokenpet_pets`처럼 접두사가 붙은 테이블을 만듭니다. 계정에 해당 앱 테이블의 `SELECT`·`INSERT`·`UPDATE`·`DELETE`·`CREATE`·`ALTER`·`INDEX` 권한을 부여하세요. InnoDB와 `utf8mb4_bin`을 사용합니다.
- `TOKENPET_DB_NAMESPACE`를 바꾸면 PostgreSQL 스키마 / MariaDB 테이블 접두사가 바뀝니다. 같은 DB에 별도 설치를 여러 개 둘 때 서로 다른 값을 지정하세요. 기존 앱 테이블을 이름 변경하거나 이동하지는 않습니다.

풀 기본값은 **앱 컨테이너당 최대 30개, 최소 유지 5개, 연결·대기 제한 10초, 유휴 정리 30초**입니다. PostgreSQL은 필요할 때 연결을 만들고, 만들어진 연결 중 최소 5개를 유지합니다. MariaDB는 최소 연결을 미리 준비합니다. 최소치를 생략하면 최대치가 5 미만일 때 함께 낮아집니다. 여러 앱이 같은 DB를 사용하면 전체 풀 최대값 합계와 DB의 최대 연결 수를 함께 조정합니다. [PostgreSQL 드라이버의 풀 옵션](https://node-postgres.com/apis/pool), [MariaDB 드라이버의 풀 옵션](https://mariadb.com/docs/connectors/mariadb-connector-nodejs/connector-nodejs-promise-api)을 따릅니다.

원격 DB는 위 예제처럼 TLS를 켜세요. 사설 CA가 필요하면 인증서를 컨테이너에 읽기 전용으로 마운트하고 `NODE_EXTRA_CA_CERTS=/컨테이너/내/ca.pem`을 앱 환경에 지정합니다. 인증서 검증을 끄는 설정은 필요하지 않습니다.

URL을 환경 변수 대신 Docker secret으로 전달하려면, URL 한 줄을 저장한 `.env.database-url` 파일을 준비하세요. 컨테이너는 UID/GID `1000:1000`으로 실행하므로 Linux 호스트에서는 `sudo chown 1000:1000 .env.database-url`과 `sudo chmod 600 .env.database-url`로 읽기 권한을 맞춥니다. Docker Desktop도 컨테이너의 `node` 사용자가 파일을 읽을 수 있어야 합니다. `.env`의 `TOKENPET_DATABASE_URL`은 비운 뒤 `compose.override.yaml`에 다음을 합칩니다.

```yaml
services:
  tokenpet:
    environment:
      TOKENPET_DATABASE_URL_FILE: /run/secrets/database_url
    secrets:
      - database_url
secrets:
  database_url:
    file: ./.env.database-url
```

`TOKENPET_DATABASE_URL`과 `TOKENPET_DATABASE_URL_FILE`은 동시에 설정할 수 없습니다. 연결·스키마 초기화에 실패하면 서버 시작을 중단하며 SQLite로 자동 전환하지 않습니다. `/api/health`도 DB 연결을 확인합니다. 외부 DB를 사용해도 로컬 호환 키를 보관하는 `/data` 볼륨은 유지하세요.

**기존 SQLite 데이터는 외부 DB로 자동 이관하지 않습니다.** 외부 DB를 처음 연결하면 새 작업실로 시작하며 원래 SQLite 파일은 그대로 남습니다. 기존 저장 데이터를 옮겨야 한다면 먼저 백업하고 별도 이관 작업을 진행하세요. 외부 DB 백업은 PostgreSQL/MariaDB의 백업 도구로 관리해야 하며 `/data` 볼륨 백업만으로는 포함되지 않습니다.

### IP 또는 사설 인증서로 연결

공인 도메인이 있으면 Caddy가 공인 인증서를 자동 발급·갱신합니다. **IP로 구성한 Caddy는 기본적으로 자체 CA 인증서를 사용**하므로, 연결할 컴퓨터에도 그 CA가 필요합니다. 인증서 검증은 끄지 않습니다.

서버에서 공개 CA 인증서만 꺼냅니다.

```sh
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./tokenpet-root.crt
```

이 파일을 SSH/SCP 등 신뢰할 수 있는 경로로 개발 컴퓨터에 전달한 후, 설치 전에 지정하세요. 서버의 개인키 파일은 전달하지 않습니다.

```sh
export NODE_EXTRA_CA_CERTS="$HOME/tokenpet-root.crt"
curl -fsSL https://raw.githubusercontent.com/shariest/tokenpet/main/install.sh | bash
```

Windows PowerShell에서는 다음과 같이 지정합니다.

```powershell
$env:NODE_EXTRA_CA_CERTS = "$env:USERPROFILE\tokenpet-root.crt"
irm https://raw.githubusercontent.com/shariest/tokenpet/main/install.ps1 | iex
```

설치 프로그램은 이 인증서 경로를 CLI 연결에도 등록합니다. 설치 화면에 서버 IP를 입력하면 됩니다. IPv6는 `2001:db8::1`, 포트가 있으면 `[2001:db8::1]:8443` 형식입니다. HTTPS Compose는 443을 사용합니다.

### 운영과 원격 사용량

Claude·Codex의 MCP가 연결된 동안 개발 컴퓨터의 사용량 수집기가 **10초마다** 서버에 사용량을 보냅니다. 프롬프트나 소스 코드는 보내지 않습니다. CLI를 종료했다가 다시 실행하면 놓친 기록도 읽으며 중복 보상하지 않습니다. CLI 밖에서 계속 수집하려면 `tokenpet watch`, 한 번만 동기화하려면 `tokenpet sync`를 실행하세요. 서버에서 개발 컴퓨터의 로그 폴더를 마운트할 필요는 없습니다.

```sh
docker compose logs --tail=100
docker compose restart
docker compose down          # 종료, 데이터 볼륨 유지
```

업데이트는 같은 서버 폴더에서 위 다운로드 명령을 다시 실행한 뒤 `docker compose up -d --build`로 반영합니다. `.env`를 다시 복사할 필요는 없습니다. **`docker compose down -v`는 게임 데이터와 인증서를 삭제합니다.** 한 서버가 여러 회원을 관리하며 같은 회원 토큰을 사용하는 여러 컴퓨터·CLI만 같은 게임을 공유합니다. 이전 버전으로 되돌릴 때는 업데이트 전에 만든 백업을 복원하세요.

이미 HTTPS 프록시를 운영한다면 Docker 이미지 또는 Node 서버만 그 뒤에 연결할 수도 있습니다.

```sh
# 서버: 별도 키를 주입할 때는 최소 32자의 TOKENPET_API_KEY_FILE 또는 TOKENPET_API_KEY 사용
TOKENPET_HOST=0.0.0.0 TOKENPET_PORT=4780 \
TOKENPET_PUBLIC_URL=https://pets.example.com TOKENPET_WATCH=0 npm start
```

프록시는 원래 Host를 보존해야 합니다. 공개 웹 화면은 회원 아이디·비밀번호로 로그인하며 자동 로컬 로그인을 허용하지 않습니다. API 클라이언트는 `X-API-Key` 하나로 인증합니다. Docker secrets를 사용한다면 `TOKENPET_API_KEY_FILE=/run/secrets/<이름>`으로 읽을 수 있습니다.

환경 변수는 저장된 연결 설정보다 우선합니다. 연결이 예상과 다르면 설정해 둔 `TOKENPET_SERVER`·`TOKENPET_API_KEY` 환경 변수도 확인하세요.

| 환경 변수 | 기본값 / 용도 |
| --- | --- |
| `TOKENPET_DATA_DIR` | 개인 CLI는 `~/.tokenpet`, Docker는 `/data` 영구 볼륨 |
| `TOKENPET_PORT` | 서버 포트. 기본 `4780`. Compose에서는 localhost 접속 포트 |
| `TOKENPET_ADDRESS` | HTTPS Compose에서만 필요한 공개 도메인/IP |
| `TOKENPET_DATABASE_URL` | 미지정 시 SQLite. `postgres://…` / `postgresql://…` / `mariadb://…`로 외부 DB 선택 |
| `TOKENPET_DATABASE_URL_FILE` | DB 접속 URL 한 줄을 담은 파일. Docker secret 지원 |
| `TOKENPET_DB_NAMESPACE` | `tokenpet`. PostgreSQL 스키마 / MariaDB 테이블 접두사. 영문 소문자·숫자·밑줄 1~32자, 숫자로 시작 불가 |
| `TOKENPET_DB_POOL_MAX` / `TOKENPET_DB_POOL_MIN` | 최대 `30` / 최소 유지 `5`. 최소치는 최대치 이하, 외부 DB에만 적용 |
| `TOKENPET_DB_CONNECT_TIMEOUT_MS` | `10000`. 연결 생성과 풀 대기 제한(밀리초) |
| `TOKENPET_DB_IDLE_TIMEOUT_MS` | `30000`. 유휴 연결 정리 기준(밀리초), MariaDB에서는 초 단위 올림 |
| `TOKENPET_HOST` | `127.0.0.1` |
| `TOKENPET_SERVER` | 저장된 주소를 덮어쓸 서버 도메인/IP/origin, 원격은 HTTPS 필수 |
| `TOKENPET_PUBLIC_URL` | 지정하면 회원 서버 모드. 외부는 HTTPS 필수, loopback만 HTTP 허용. Docker 기본 `http://localhost:4780`. 미지정 + loopback 실행은 개인 PC용 |
| `TOKENPET_API_KEY` | 선택적 게임 키. 미지정 시 저장된 연결 키 또는 로컬 `api-key` 사용 |
| `TOKENPET_API_KEY_FILE` | 키 파일 경로. Docker secret이나 자동 설치에 사용 |
| `NODE_EXTRA_CA_CERTS` | 사설 서버의 신뢰할 CA 인증서 경로. Node 시작 전에 지정 |
| `TOKENPET_TRUST_PROXY` | 기본 `0`. 외부 접근을 차단한 백엔드가 신뢰하는 프록시 한 대 뒤에 있을 때만 `1`. HTTPS Compose에서만 `1` |
| `TOKENPET_WATCH` | `0`이면 서버 로컬 기록 수집 끄기 |
| `TOKENPET_OVERWRITE` | `1`이면 같은 이름의 기존 명령 파일·MCP를 묻지 않고 백업한 뒤 덮어쓰기 |
| `CLAUDE_CONFIG_DIR` | Claude 기록 폴더 기준 경로 |
| `CODEX_HOME` | Codex 기록 폴더 기준 경로 |

백업은 서버를 멈춘 상태에서 개인 데이터 디렉터리(Docker는 `game` 볼륨 전체)를 복사하세요. 실행 중 SQLite 파일만 복사하면 WAL의 최신 변경을 놓칠 수 있습니다. 로컬 서버는 CLI 실행 시 필요한 경우 백그라운드로 켜지고, Docker는 `restart: unless-stopped`를 사용합니다. SQLite는 단일 앱 컨테이너와 볼륨으로 운영합니다. 외부 DB의 게임 변경은 회원별 행 잠금으로 보호하지만, 로그인 요청 제한은 앱 프로세스별이므로 기본 운영 구성은 앱 컨테이너 한 개입니다. 기본값에서는 `X-Forwarded-For`를 무시합니다. HTTPS Compose는 외부에 API 포트를 열지 않고 Caddy가 설정한 마지막 클라이언트 IP로 가입·로그인 횟수를 제한합니다. [Caddy는 외부 요청의 전달 헤더를 기본적으로 신뢰하지 않습니다](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#defaults). `TOKENPET_TRUST_PROXY=1`일 때는 백엔드를 직접 공개하지 마세요. CDN 등 프록시를 여러 대 겹치는 구성은 별도 신뢰 경로 설정이 필요합니다.

## 다음에 추가할 기능

아래는 검토 중인 후속 기능입니다.

| 우선순위 | 제안 | 이유와 참고 사례 |
| --- | --- | --- |
| 1 | 도감 완성 배지·등급별 수집 목표 | 중복 수량보다 다양한 종류를 모으는 동기를 강화합니다. [Pokémon HOME의 도감 완성 보상·도전 과제](https://home.pokemon.com/en-us/features/)와 [Habitica의 펫 수집 업적](https://github.com/HabitRPG/habitica/blob/develop/website/common/locales/en/achievements.json)을 참고했습니다. 코인 추가 지급보다 배지부터 시작하면 경제 팽창을 줄일 수 있습니다. |
| 2 | 원하는 펫 즐겨찾기·처음 만난 날짜 | 360종 중 목표를 찾고 수집 기록을 돌아볼 수 있습니다. [Pokémon HOME의 포획 달력](https://home.pokemon.com/en-us/features/)에서 착안했습니다. |
| 3 | 주간 성장 랭킹·친구끼리의 목표 | 누적 순위 외에 신규 회원도 참여할 자리를 만듭니다. [Habitica의 도전 과제 API](https://apidoc.habitica.com/)를 참고한 제안입니다. 주간 시작 시점의 기록 저장이 먼저 필요합니다. |
| 운영 우선 | 계정 복구·탈퇴, 랭킹 이상치 관리 | 이메일을 받지 않는 현재 가입 방식에 맞는 복구 수단과 사용량 자체 보고에 대한 운영 기준이 필요합니다. |

펫 교환은 [Pokémon HOME의 교환 방식](https://support.pokemon.com/hc/en-us/articles/360039431231-How-can-I-trade-Pok%C3%A9mon-using-Pok%C3%A9mon-HOME-on-my-mobile-device)을 참고할 수 있지만, 다중 계정 보상 악용과 교환 원자성·분쟁 처리가 필요해 후순위로 두었습니다.

## 검증

```sh
npm test
npm run test:database  # Docker로 격리된 PostgreSQL·MariaDB를 띄워 실제 연동 검증 후 정리
npm run check
npm run test:scenario
```

테스트는 TypeScript로 작성했고 Node 24의 내장 타입 제거로 빌드 결과물(`dist`)을 검사합니다. `npm run check`는 앱 코드와 테스트를 함께 타입 검사합니다.

`test:scenario`는 임시 홈·실제 HTTP 서버·설치된 실행기를 함께 검사합니다. macOS/Linux의 실제 PTY 검증에는 Python 3 표준 라이브러리를 사용하며, 사용자 CLI 설정이나 게임 데이터는 건드리지 않습니다.

실행 중인 회원 서버의 웹 E2E는 `playwright-cli`가 설치된 환경에서 `node scripts/e2e/run-web-smoke.mts http://localhost:4880`으로 실행합니다. 개인 서버도 `http://127.0.0.1:4780`에서 실행 중이어야 합니다. 테스트 계정으로 회원가입·돌봄·부화·도감·랭킹·토큰 교체를 검사하고, 개인 서버는 화면 조회만 합니다. 결과와 1920×1080·모바일 캡처는 Git에서 제외한 `scripts/e2e/reports/`에 저장합니다. 생성한 테스트 계정 이름은 `result.json`에서 확인할 수 있습니다.

정산·제공자별 독립 보상·재전송·부분 JSONL·가챠 경계 확률·천장·중복·롤백·동시 요청·돌봄·성장·인증·CSRF·공유·영속성·MCP stdio·CLI 통합을 검사합니다. 설치 전부터 열린 셸의 명령 캐시, 자동 설치 재실행, 셸 설정 보존, 명령 충돌, 실행 인자 전달, CLI 업데이트 후 연결 복구, 패키지 삭제 후 복귀, 서버 동시 시작과 재시작도 검사합니다. 회원 간 격리, 로그인/세션 만료·로그아웃, 토큰 단일 발급·원자적 교체·폐기, 공개 정보 경계, 종류별 랭킹도 검사합니다. 테스트는 외부 모델을 호출하지 않습니다.

영감: [Ido-Levi/claude-code-tamagotchi](https://github.com/Ido-Levi/claude-code-tamagotchi)의 터미널 동반자 아이디어. 이 구현의 게임 엔진과 픽셀 아트는 새로 작성했습니다.
