#!/bin/bash
# Bash Deployment Script for Google Cloud Run (Artifact Registry)
set -e

echo "Building project locally to ensure no compilation errors..."
npm run build

echo "Submitting build to Google Cloud Build..."
gcloud builds submit --tag us-central1-docker.pkg.dev/yudi-cts-prod/ecoregent/echoregent

ENV_VARS="ECHOREGENT_HOST=0.0.0.0"

# Check if local firebase-service-account.json exists
if [ -f "data/firebase-service-account.json" ]; then
  echo "Firebase Service Account file found. Reading and setting environment variable..."
  SVC_ACC_CONTENT=$(cat data/firebase-service-account.json | tr -d '\n' | tr -d '\r')
  ENV_VARS="$ENV_VARS,FIREBASE_SERVICE_ACCOUNT=$SVC_ACC_CONTENT"
else
  echo "No local Firebase Service Account found. Deploying with local file/SQL fallback..."
fi

echo "Deploying to Google Cloud Run..."
gcloud run deploy echoregent \
  --image us-central1-docker.pkg.dev/yudi-cts-prod/ecoregent/echoregent \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars="$ENV_VARS"

echo "EchoRegent deployed successfully!"
