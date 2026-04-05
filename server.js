<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>404 - Page Not Found</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', Arial, sans-serif;
      background: #f8f9fa;
      min-height: 100vh;
      color: #333;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }

    .container {
      text-align: center;
      max-width: 500px;
      width: 100%;
      background: white;
      padding: 3rem 2rem;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
    }

    .error-code {
      font-size: 6rem;
      font-weight: 700;
      color: #6c757d;
      margin-bottom: 1rem;
      line-height: 1;
    }

    .error-title {
      font-size: 1.5rem;
      font-weight: 600;
      color: #495057;
      margin-bottom: 1rem;
    }

    .error-description {
      font-size: 1rem;
      color: #6c757d;
      margin-bottom: 2rem;
      line-height: 1.5;
    }

    .btn {
      display: inline-block;
      padding: 0.75rem 1.5rem;
      font-size: 1rem;
      font-weight: 500;
      text-decoration: none;
      border-radius: 5px;
      transition: all 0.2s ease;
      border: 1px solid #dee2e6;
      background: #f8f9fa;
      color: #495057;
    }

    .btn:hover {
      background: #e9ecef;
      border-color: #adb5bd;
    }

    .btn:focus {
      outline: 2px solid #007bff;
      outline-offset: 2px;
    }

    /* Mobile Optimization */
    @media (max-width: 480px) {
      .container {
        padding: 2rem 1.5rem;
        margin: 1rem;
      }

      .error-code {
        font-size: 4rem;
      }

      .error-title {
        font-size: 1.25rem;
      }

      .btn {
        width: 100%;
        max-width: 200px;
      }
    }
  </style>
</head>

<body>
  <div class="container">
    <div class="error-code">404</div>
    <h1 class="error-title">Page Not Found</h1>
    <p class="error-description">
      The page you're looking for doesn't exist or has been moved.
    </p>
    <a href="javascript:history.back()" class="btn" role="button">
      Go Back
    </a>
  </div>
</body>

</html>
