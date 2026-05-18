import { defineQuery, useQuery, defineAction, useAction } from '@dartsx-toolkit/query';

interface Post {
  id: number;
  title: string;
  body: string;
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

const postsQuery = defineQuery(async (signal: AbortSignal): Promise<Post[]> => {
  await delay(1000);
  const res = await fetch('https://jsonplaceholder.typicode.com/posts?_limit=5', { signal });
  return res.json();
});

const postQuery = defineQuery(async (id: number, signal: AbortSignal): Promise<Post> => {
  await delay(800);
  const res = await fetch(`https://jsonplaceholder.typicode.com/posts/${id}`, { signal });
  return res.json();
});

const createPostAction = defineAction(async (title: string, body: string): Promise<Post> => {
  await delay(1000);
  const res = await fetch('https://jsonplaceholder.typicode.com/posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, body, userId: 1 }),
  });
  return res.json();
});

const deletePostAction = defineAction(async (id: number): Promise<void> => {
  await delay(1000);
  await fetch(`https://jsonplaceholder.typicode.com/posts/${id}`, {
    method: 'DELETE',
  });
});

export component QueryDemo() {
  state selectedId: number | null = null;

  derived posts = useQuery(postsQuery());
  derived post = useQuery(selectedId !== null && postQuery(selectedId));

  render (
    <div>
      <h2>Query Demo</h2>

      <h3>Posts List</h3>
      {if (posts.loading) (
        <p>Loading posts...</p>
      )}
      {if (posts.error) (
        <p>Error: {(posts.error as Error).message}</p>
      )}
      {if (posts.data) (
        <ul>
          {for (const p of posts.data) (
            <li key={p.id}>
              <button onclick={() => selectedId = p.id}>{p.title}</button>
            </li>
          )}
        </ul>
      )}
      <button onclick={() => posts.refetch()}>Refetch Posts</button>

      {if (selectedId !== null) (
        <div>
          <h3>Selected Post</h3>
          {if (post.loading) (
            <p>Loading post...</p>
          )}
          {if (post.error) (
            <p>Error: {(post.error as unknown as Error).message}</p>
          )}
          {if (post.data) (
            <div>
              <h4>{post.data!.title}</h4>
              <p>{post.data!.body}</p>
            </div>
          )}
          <button onclick={() => selectedId = null}>Clear Selection</button>
        </div>
      )}

      <hr />
      <h3>Actions Demo</h3>
      <CreatePostForm />
      <DeletePostDemo />
    </div>
  )
}

component CreatePostForm() {
  state title = '';
  state body = '';

  derived createPost = useAction(createPostAction, {
    onSuccess: (data) => {
      console.log('Created post:', data);
      title = '';
      body = '';
    },
  });

  render (
    <div>
      <h4>Create Post</h4>
      <input
        type="text"
        placeholder="Title"
        value={title}
        oninput={(e) => title = (e.target as HTMLInputElement).value}
      />
      <input
        type="text"
        placeholder="Body"
        value={body}
        oninput={(e) => body = (e.target as HTMLInputElement).value}
      />
      <button
        onclick={() => createPost(title, body)}
        disabled={createPost.loading || !title}
      >
        {createPost.loading ? 'Creating...' : 'Create Post'}
      </button>
      {if (createPost.error) (
        <p style="color: red">Error: {(createPost.error as Error).message}</p>
      )}
      {if (createPost.success && createPost.data) (
        <p style="color: green">Created post #{createPost.data.id}: {createPost.data.title}</p>
      )}
      <button onclick={() => createPost.reset()} disabled={!createPost.success && !createPost.error}>
        Reset
      </button>
    </div>
  )
}

component DeletePostDemo() {
  state postId = 1;

  derived deletePost = useAction(deletePostAction, {
    onSuccess: () => console.log(`Deleted post ${postId}`),
    onError: (err) => console.error('Delete failed:', err),
  });

  render (
    <div>
      <h4>Delete Post</h4>
      <input
        type="number"
        value={postId}
        oninput={(e) => postId = Number((e.target as HTMLInputElement).value)}
        min="1"
      />
      <button
        onclick={() => deletePost(postId)}
        disabled={deletePost.loading}
      >
        {deletePost.loading ? 'Deleting...' : `Delete Post #${postId}`}
      </button>
      {if (deletePost.error) (
        <p style="color: red">Error: {(deletePost.error as Error).message}</p>
      )}
      {if (deletePost.success) (
        <p style="color: green">Post deleted successfully!</p>
      )}
    </div>
  )
}
