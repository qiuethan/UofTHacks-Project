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

### AI Agent
- `POST /agent/decision`: Stateless endpoint used by the `realtime-server`. Receives a robot's position and map dimensions, returns the next move target. Currently implements a random walk algorithm.

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