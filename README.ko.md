<h1 align="center">Interlinear</h1>

<p align="center">
  <a href="https://obsidian.md">Obsidian</a> 읽기 보기용 문단별 대조 번역
</p>

<p align="center">
  <a href="https://github.com/linyp/obsidian-interlinear/blob/main/README.md">English</a> ·
  <a href="https://github.com/linyp/obsidian-interlinear/blob/main/README.zh-CN.md">简体中文</a> ·
  <a href="https://github.com/linyp/obsidian-interlinear/blob/main/README.zh-TW.md">繁體中文</a> ·
  <a href="https://github.com/linyp/obsidian-interlinear/blob/main/README.ja.md">日本語</a> ·
  <strong>한국어</strong> ·
  <a href="https://github.com/linyp/obsidian-interlinear/blob/main/README.vi.md">Tiếng Việt</a> ·
  <a href="https://github.com/linyp/obsidian-interlinear/blob/main/README.ru.md">Русский</a> ·
  <a href="https://github.com/linyp/obsidian-interlinear/blob/main/README.pt-BR.md">Português (Brasil)</a> ·
  <a href="https://github.com/linyp/obsidian-interlinear/blob/main/README.es.md">Español</a>
</p>

<p align="center">
  <img src="images/interlinear-bilingual.png" alt="Obsidian에서 문단별 이중 언어 번역을 표시하는 Interlinear" width="900">
</p>

[Obsidian](https://obsidian.md) 읽기 보기에서 사용하는 문단별 **대조 번역** 플러그인입니다.
외국어 노트를 열고 버튼을 누르면 각 원문 문단 아래에 한국어 또는 원하는 대상 언어의 번역을
표시합니다. 원문과 번역을 함께 보거나 번역만 볼 수 있습니다.

> 현재 플러그인 UI는 영어입니다. 이 README의 설정 및 명령 이름은 실제 영어 UI와 동일하게
> 표기합니다.

## 안전을 우선한 설계

- **노트를 수정하지 않습니다.** 번역은 렌더링 계층의 DOM에만 삽입됩니다. 노트를 닫았다가 다시
  열어도 디스크의 Markdown 파일은 그대로 유지됩니다.
- **자동으로 번역하지 않습니다.** 노트를 열거나 전환할 때, 스크롤할 때, 레이아웃이나 설정을
  변경할 때 번역 요청을 보내지 않습니다. 번역은 사용자가 플로팅 버튼, 상태 표시줄 또는 명령
  팔레트에서 명시적으로 실행할 때만 시작됩니다.
- **BYOK, 텔레메트리 없음.** API 키와 앱 자격 증명은 Vault 내부의 플러그인 설정 파일에만
  저장되며, 사용자가 선택한 번역 서비스 외에는 전송되지 않습니다.
- **읽기 보기 전용**입니다. 편집 모드와 Live Preview는 지원 범위에 포함되지 않습니다.

## 주요 기능

- **클릭 한 번으로 노트 전체 번역.** 데스크톱에서는 상태 표시줄, 모바일에서는 오른쪽 아래의
  플로팅 버튼으로 실행합니다. 번역 중에는 진행률(`3/12` 등)이 표시됩니다.
- **두 가지 표시 모드.** 원문과 번역을 함께 보는 이중 언어 모드와 번역만 보는 모드를 추가 요청
  없이 즉시 전환합니다. 번역 전용 모드에서는 마우스를 올리거나 모바일에서 탭해 원문을 확인할 수
  있습니다.
- **다섯 가지 번역 스타일.** 테두리, 인용 블록, 흐린 텍스트, 점선 밑줄, 학습용 마스크를 CSS만으로
  전환할 수 있습니다.
- **영구 번역 캐시.** 콘텐츠 해시를 키로 사용해 플러그인 폴더의 `cache.json`에 저장합니다. 같은
  문단을 다시 번역하는 시간과 비용을 줄이며, 원문 자체는 캐시에 저장하지 않습니다.
- **Obsidian 가상화 렌더링 대응.** 현재 보이는 블록은 즉시 번역하고 나머지는 캐시에 미리 번역한 뒤,
  스크롤할 때 이미 캐시된 번역만 DOM에 삽입합니다.
- **번역할 필요가 없는 내용 건너뛰기.** 코드, 수식, 이미지만 있는 블록, URL, 기호·숫자만 있는
  블록과 대상 언어라고 안전하게 판별할 수 있는 블록을 제외합니다.
- **교체 가능한 번역 백엔드.** DeepSeek, OpenAI, SiliconFlow, Ollama, 사용자 지정 OpenAI 호환
  엔드포인트와 Baidu Translate(百度翻译), Youdao(有道智云)를 지원합니다. 네트워크 요청에는
  Obsidian의 `requestUrl`을 사용합니다.
- **대상 언어 프리셋.** 한국어(`ko`), 일본어(`ja`), 베트남어(`vi`), 중국어 간체·번체, 영어 등을
  선택할 수 있으며 사용자 지정 언어 코드도 입력할 수 있습니다.

## 네트워크, 계정 및 개인정보

- **외부 서비스를 사용합니다.** 사용자가 번역을 실행하거나 **Test connection**을 누른 경우에만
  번역 대상 문단을 현재 선택된 서비스로 보냅니다.
- **계정이 필요합니다.** 선택한 서비스의 API 키 또는 앱 자격 증명을 직접 준비해야 합니다.
  사용료는 해당 서비스가 청구하며 Interlinear가 청구하지 않습니다.
- **텔레메트리가 없습니다.** 사용 통계를 수집하거나 분석 데이터를 전송하지 않습니다.
- 설정은 `data.json`, 마이그레이션 전 일회성 백업은 `data.backup.json`, 번역 캐시는
  `cache.json`에 저장됩니다. 모두 플러그인 폴더 안에만 위치합니다.
- Vault를 동기화하면 자격 증명도 함께 동기화됩니다. Vault를 Git으로 관리한다면 최소한
  `.obsidian/plugins/interlinear/data.json`과
  `.obsidian/plugins/interlinear/data.backup.json`을 `.gitignore`에 추가하세요.

## 설치

### Obsidian에서 설치(권장)

1. **Settings → Community plugins → Browse**를 엽니다.
2. **Interlinear**를 검색한 다음 **Install**, **Enable**을 차례로 선택합니다.

또는 [플러그인 디렉터리 페이지](https://obsidian.md/plugins?id=interlinear)를 열고
**Install**을 누릅니다.

### v0.2.5에서 v0.3.0으로 업그레이드

v0.3.0은 설정 스키마 v2를 사용합니다. v0.2.5의 평면 설정은 한 번만 마이그레이션되며,
`data.json`을 다시 쓰기 전에 기존 데이터가 `data.backup.json`에 보존됩니다.

플러그인 설정을 동기화한다면 설정을 변경하기 전에 **동기화된 모든 기기**에서 Interlinear를
업데이트하세요. 서로 다른 플러그인 버전을 함께 사용하거나 마이그레이션 후 다운그레이드하는 것은
지원되지 않습니다.

### BRAT / 수동 설치

- 정식 디렉터리보다 먼저 최신 빌드를 받으려면 [BRAT](https://github.com/TfTHacker/obsidian42-brat)을
  설치하고 **BRAT: Add a beta plugin for testing**에서 `linyp/obsidian-interlinear`를 입력합니다.
- 수동 설치는 [최신 릴리스](https://github.com/linyp/obsidian-interlinear/releases/latest)에서
  `main.js`, `manifest.json`, `styles.css`를 받아
  `<your-vault>/.obsidian/plugins/interlinear/`에 넣습니다.

## 설정

**Settings → Interlinear**를 엽니다.

| 설정 | 기본값 | 설명 |
| --- | --- | --- |
| Service | DeepSeek | LLM 또는 기존 기계 번역 서비스를 선택합니다. 각 프리셋은 자격 증명과 고급 설정을 별도로 보관합니다. |
| API key _(LLM 전용)_ | _비어 있음_ | 선택한 LLM 서비스의 API 키입니다. |
| App ID + secret _(Baidu / Youdao)_ | _비어 있음_ | 각 서비스의 개발자 콘솔에서 발급받은 앱 자격 증명입니다. |
| Base URL _(LLM 전용)_ | `https://api.deepseek.com` | OpenAI 호환 엔드포인트입니다. |
| Model _(LLM 전용)_ | `deepseek-v4-flash` | 사용할 모델 이름입니다. |
| Test connection | — | 작은 요청 한 번으로 자격 증명과 연결을 확인합니다. |
| Target language | `zh-CN` | `ko`, `ja`, `vi` 등의 프리셋 또는 사용자 지정 언어 코드를 선택합니다. |
| Default display mode | Bilingual | 첫 번역 후의 표시 방식입니다. |
| Translation style | Border | 번역문 표시 스타일입니다. |
| Floating button | Mobile only | Always / mobile only / never. |
| Concurrency | 10 | 동시에 진행할 최대 요청 수입니다. |
| Min interval (ms) | 0 | 요청 시작 사이의 간격입니다. |
| Max retries | 3 | 429 및 일시적 오류에 대한 재시도 횟수입니다. |
| Batch char budget | 4000 | 요청 하나에 묶을 최대 문자 수입니다. |
| Max segments per request | 12 | 요청 하나에 묶을 최대 블록 수입니다. |
| Custom instructions _(LLM 전용)_ | _비어 있음_ | 용어집, 어조, 분야 등의 지침을 프롬프트에 추가합니다. 변경 내용은 캐시 식별자에도 반영됩니다. |
| Persistent cache | On | 앱 재시작 후에도 번역 캐시를 유지합니다. |

## 사용법

1. 노트를 열고 **reading view**로 전환합니다.
2. 데스크톱에서는 상태 표시줄의 **Translate**, 모바일에서는 오른쪽 아래 플로팅 버튼을 누릅니다.
3. 다시 누르면 번역과 원문 표시를 전환합니다.
4. 모드 버튼으로 **bilingual**과 **translation-only**를 전환합니다. 이 동작은 새로운 번역 요청을
   만들지 않습니다.

명령 팔레트에는 다음 명령이 있습니다. 기본 단축키는 지정되어 있지 않습니다.

- **Interlinear: Translate / show original**
- **Interlinear: Toggle display mode (bilingual / translation-only)**
- **Interlinear: Clear translations**

## 개발

빌드, 테스트, 릴리스 절차와 아키텍처는
[영문 README의 Develop 섹션](https://github.com/linyp/obsidian-interlinear/blob/main/README.md#develop)을
참고하세요.

## 제한 사항

- 읽기 보기 전용이며 편집 모드와 Live Preview는 지원하지 않습니다.
- 목록과 표는 하나의 블록으로 번역됩니다. 평면 목록은 목록 형태로 다시 표시하지만 중첩 구조를
  완전히 복원하지는 않습니다.

## 라이선스

MIT
