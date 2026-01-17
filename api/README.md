# Avatar API

A Python FastAPI service providing REST endpoints for avatar management and AI decision-making.

## 🛠 Tech Stack
- **Framework:** FastAPI
- **Database:** SQLite (`data/avatars.db`)
- **Storage:** Supabase Storage (bucket: `sprites`)
- **Server:** Uvicorn

## 📂 Structure
- `app/main.py`: Application entry point and route definitions.
- `app/database.py`: SQLite connection and CRUD operations for Avatar metadata.
- `app/models.py`: Pydantic data models.

## 🔑 Key Features

### Avatar Management
- `POST /avatars`: Create a new avatar profile.
- `GET /avatars`: List all avatars.
- `PATCH /avatars/{id}`: Update bio/color.
- `POST /avatars/{id}/sprite`: Upload an image file. Images are stored in Supabase Storage, and the public URL is saved to the database.

### Avatar Generation
- `POST /generate-avatar`: Generate pixel art avatar sprites from a photo.
  - **Input:** A photo file (PNG, JPEG, or WebP)
  - **Output:** 4 directional sprite views (front, back, left, right) with transparent backgrounds
  - **Storage:** Images are uploaded to the `sprites` bucket in Supabase Storage
  - Each upload creates a new folder with a unique ID, preserving all previous generations

### AI Agent
- `POST /agent/decision`: Stateful decision endpoint used by the `realtime-server`. 
  - **Inputs:** Current position, map dimensions, nearby entities, and pending conversation requests.
  - **Outputs:** Decisions such as `MOVE` (with target coordinates), `STAND_STILL`, `REQUEST_CONVERSATION`, `ACCEPT_CONVERSATION`, or `REJECT_CONVERSATION`.
  - **Logic:** Currently uses interest-based probability scores to decide whether to interact with nearby players or other robots.

## 🚀 Usage

### 1. Setup Environment
Create a `.env` file in the `api/` directory with your Supabase credentials (see `.env.example`):
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
```

### 2. Install Dependencies
```bash
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
```

### 3. Run Server
**Important:** Run as a module from the `api` directory to resolve relative imports correctly.
```bash
python -m app.main
```
Server runs on `http://localhost:3003`.

## 📸 Generate Avatar Sprites

The `/generate-avatar` endpoint generates Pokemon GBA-style pixel art sprites from a photo.

### Example Request

```bash
curl -X POST http://localhost:3003/generate-avatar \
  -F "photo=@path/to/your/photo.png"
```

### Example Response

```json
{
  "ok": true,
  "message": "Avatar generated successfully with 4 views",
  "images": {
    "front": "https://your-project.supabase.co/storage/v1/object/public/sprites/{session-id}/front.png",
    "back": "https://your-project.supabase.co/storage/v1/object/public/sprites/{session-id}/back.png",
    "left": "https://your-project.supabase.co/storage/v1/object/public/sprites/{session-id}/left.png",
    "right": "https://your-project.supabase.co/storage/v1/object/public/sprites/{session-id}/right.png"
  }
}
```

### How It Works

1. Upload a photo of a person (PNG, JPEG, or WebP)
2. The API uses AI (Gemini 3 Pro) to generate a 4x4 sprite sheet in Pokemon GBA style
3. Extracts 4 directional views: front, back, left, right
4. Removes the green background for transparency
5. Uploads all 4 images to the `sprites` bucket in Supabase Storage
6. Returns public URLs for each view

**Note:** Each generation creates a new folder with a unique session ID. Old generations are preserved and not deleted.