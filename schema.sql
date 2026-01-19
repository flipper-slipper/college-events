-- Table for raw scraped posts
CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    instagram_id TEXT UNIQUE,
    image_url TEXT,
    caption TEXT,
    processed BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Table for extracted event information
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id TEXT,
    title TEXT,
    description TEXT,
    event_date TEXT,
    event_time TEXT,
    location TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES posts(id)
);
