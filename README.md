# NOT IN MY HOUSE

> 這是我家。滾出去。

末日的黑雨之夜，你被困在停電的電梯裡，停在 8 樓——你家那一層。門外、家裡、樓梯間、樓下廣場，全都是「影」。拿起爺爺的刀，殺出一條血路，到廣場另一頭的救援車跟家人會合。

瀏覽器裡的第三人稱 3D 動作遊戲。場景重建自真實的家（[Mi Casa es Su Casa](https://github.com/BCJACK0125/Mi-Casa-es-Su-Casa)），角色、戰鬥與特效建立在 [Samurai Third-Person Template](https://github.com/achrefelouafi/SamuraiThirdPersonTemplateThreeJS) 上。

▶ 前導片：[`media/trailer.webm`](media/trailer.webm)（遊戲開始時也會即時播放，可按住 Enter / Esc 跳過）

## 怎麼玩

| 操作 | 按鍵 |
| --- | --- |
| 移動 / 奔跑 | `W` `A` `S` `D`，按住 `Shift` 奔跑 |
| 視角 | 滑鼠（點畫面鎖定游標），滾輪拉遠拉近 |
| 斬（需要刀） | 左鍵 / `R` — 連按可以連段，範圍內的敵人全部砍到 |
| 踢 | 右鍵 / `E` |
| 滑斬突進 | `Q` |
| 閃避（無敵） | `Space` — 在敵人出手瞬間閃開會觸發「見切」慢動作 |
| 互動 | `F`：撬門、開門、取刀、看紙條、開冰箱、上車 |
| 奧義 | `V` 影分身（60 氣）· `C` 天罰（40 氣）· `X` 萬劍（100 氣，只能在戶外） |
| 暫停 | `Esc` |

**手機**：以橫放為主。按下開始時會進入全螢幕並鎖定橫向（Android Chrome）；iPhone 不支援鎖定方向，直立時會出現「請把手機橫過來」並暫停，轉過來就繼續。左下是浮動搖桿（推到底＝奔跑），右下是 斬／踢／滑／閃／F，上方是奧義 影／罰／劍（氣不夠時會變暗），其餘畫面拖曳轉視角；過場動畫右下角有「跳過」。手機版會自動降低畫面負擔（關閉泛光、較小的陰影貼圖、較少的霧與落葉）。

## 故事與關卡

| 章節 | 地點 | 內容 |
| --- | --- | --- |
| 前導片 | 城市 → 大樓 → 電梯 | 黑雨、影、停電。全程是遊戲引擎即時演算的運鏡，不是預錄影片 |
| 序章　電梯 | 8F 電梯、梯廳 | 撬開卡住的電梯門，赤手（只能踢）擊退梯廳的兩隻影 |
| 第一章　我家 | 客廳、走道、主臥、房間一二、餐廳、廚房、浴室、陽台 | 到主臥衣櫃取出爺爺的刀（刀身會燃燒），清空整間家；讀媽媽留在餐桌上的紙條；**走出陽台**俯瞰廣場上的屍潮與救援車——它們聽到了，從陽台欄杆和大門兩邊爬進來 |
| 第二章　樓梯間 | 8F → 1F 的折返樓梯 | 沒電，只能一層一層往下殺。樓梯平台、各樓梯廳都有埋伏 |
| 最終章　樓外 | 大樓外的 L 形廣場 | 燃燒的車、路燈、樹、路障。殺出血路，第二波從黑雨中站起來，最後是首領「黑潮之母」 |
| 尾聲 | 天亮 | 影在晨光中燒成灰。上救援車 |

每一章都有檢查點；倒下後從最近的檢查點重來，進度也會記在瀏覽器裡（標題畫面「從檢查點繼續」）。

## 遊戲機制

- **生命 / 氣**：被打掉血；打中、擊倒、見切會累積「氣」，用來放奧義。冰箱可以吃一次回滿，敵人會掉回復道具。
- **敵人**（全部是同一副骨架，動作從主角的招式重新套上去）：
  - 影：基本型，3 下。疾影：紅色、快、脆。巨影：紫色、大隻、重擊會震地。黑潮之母：首領，半血時召喚援軍並加速。
  - 出手前身上會發亮橘光（預兆），給你閃避的時間。同一時間最多兩隻會出手，其他的會在旁邊繞——一次打一群也公平。
- **打擊感**：命中停頓（hit-stop）、鏡頭震動、白光閃爍、血、傷害數字、連擊數；致命一擊交給布娃娃物理，斬擊會把身體切成兩半。
- **尋路**：同一層樓用距離場（Dijkstra）讓整群敵人繞過家具和牆；樓梯間把折返樓梯當成一條線，敵人會追上追下；跨區時會走門口與樓梯口。

## 空間設計

- 家的平面依原本 Mi-Casa 的實測尺寸，水平放大 1.5 倍、垂直 1.25 倍，讓第三人稱和刀戰有空間；拆掉室內門（被撞壞倒在地上）、移走小雜物，大型家具保留當掩體。
- 陽台改成可以走出去：滑門推開、鐵窗拆掉換成欄杆，從 8 樓看得到整個廣場、敵人與閃著警示燈的救援車。
- 樓梯間是 1F–8F 共 8 個樓層模組堆疊，往上的路被雜物堵死；1F 玻璃門通往戶外。
- 戶外是一個被城市包圍的廣場，大樓、路燈、燃燒的車與油桶、路障、行道樹。
- 第三人稱鏡頭有牆面/天花板碰撞與越肩偏移，在窄走道與電梯裡也看得到前方。

## 本機執行

不需要建置步驟（three.js 以 import map 從 jsDelivr 載入），任何靜態伺服器都可以：

```bash
python -m http.server 8000
# 開 http://localhost:8000
```

## 部署到 GitHub Pages

1. 把整個資料夾（`index.html`、`src/`、`models/`、`animations/`、`hdri/`、`textures/`、`assets/`、`media/`、`.nojekyll`）推到 `main` 分支。
2. GitHub 專案 → **Settings → Pages** → Source 選 **Deploy from a branch**，Branch 選 `main`、資料夾 `/ (root)`。
3. 一兩分鐘後打開 `https://bcjack0125.github.io/NOT-IN-MY-HOUSE/`。

所有路徑都是相對路徑，放在子目錄也能跑。總下載量約 35 MB（主要是角色模型與動作），第一次載入需要一點時間。

## 程式結構

```
index.html            介面：標題、HUD、暫停、結局、觸控按鈕
src/core/App.js       建立所有系統、每幀更新順序
src/core/PlayerCamera.js  第三人稱鏡頭（碰撞、越肩、過場接管）
src/world/World.js    可站立的地面（多樓層、樓梯斜坡）、碰撞、射線、尋路網格與樓梯路徑
src/world/Level.js    蓋出整個關卡：8F 的家、8 層樓梯間、1F、外牆、廣場、城市
src/house/            Mi-Casa 的建模工具、家具與程式貼圖（略作修改）
src/combat/           敵人 AI（Enemy.js）、族群與尋路（EnemyManager.js）、布娃娃
src/game/Game.js      規則：生命、氣、傷害、檢查點、互動、拾取、黎明
src/game/Story.js     劇本：每個章節、出怪、過場運鏡、前導片與結局
src/game/Cinematic.js 即時過場系統（鏡頭運動 + 字幕）
src/game/Sound.js     WebAudio 合成的音效與動態配樂（沒有音檔）
src/config/enemyTypes.js  四種敵人的數值
```

## 素材與授權

- 程式：MIT。角色控制、戰鬥、特效、後製與世界系統源自 [SamuraiThirdPersonTemplateThreeJS](https://github.com/achrefelouafi/SamuraiThirdPersonTemplateThreeJS)（MIT © mohamedachrefelouafi）。
- 角色模型：[dark_igorek](https://sketchfab.com/dark_igorek)（Sketchfab）；動作：[Mixamo](https://mixamo.com)；地面與月球貼圖：[ambientCG](https://ambientcg.com)；HDRI：[Poly Haven](https://polyhaven.com)。為了網頁載入，模型內嵌的貼圖已重新壓縮。
- 家的場景與照片貼圖：[Mi Casa es Su Casa](https://github.com/BCJACK0125/Mi-Casa-es-Su-Casa)。
- [three.js](https://threejs.org) r185。
