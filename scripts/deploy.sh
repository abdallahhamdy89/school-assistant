#!/bin/bash

set -e

PROJECT_ID="school-assistant-499518"
REGION="europe-west1"
SERVICE="school-assistant"
REPOSITORY="school-assistant"
IMAGE="europe-west1-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/app"
REVISIONS_TO_KEEP=2

echo "======================================"
echo " School Assistant Deployment"
echo "======================================"
echo

gcloud config set project "$PROJECT_ID"

COMMIT=$(git rev-parse --short HEAD)

echo "Deploying commit: $COMMIT"
echo

echo "Building Docker image..."

gcloud builds submit \
    --tag "${IMAGE}:${COMMIT}"

echo
echo "Docker build completed."
echo

echo "Deploying new Cloud Run revision..."

gcloud run deploy "$SERVICE" \
    --image="${IMAGE}:${COMMIT}" \
    --region="$REGION" \
    --platform=managed \
    --allow-unauthenticated \
    --service-account="593069879057-compute@developer.gserviceaccount.com" \
    --env-vars-file="cloudrun-env.yaml" \
    --set-secrets="GROQ_API_KEY=groq-api-key:latest,FLASK_SECRET_KEY=flask-secret-key:latest"

echo
echo "======================================"
echo " Deployment completed successfully"
echo "======================================"
echo

REVISION=$(gcloud run services describe "$SERVICE" \
    --region="$REGION" \
    --format="value(status.latestReadyRevisionName)")

echo "Revision: $REVISION"

echo
echo "Cleaning up old revisions (keeping the $REVISIONS_TO_KEEP most recent)..."

OLD_REVISIONS=$(gcloud run revisions list \
    --service="$SERVICE" \
    --region="$REGION" \
    --sort-by="~metadata.creationTimestamp" \
    --format="value(metadata.name)" | tail -n "+$((REVISIONS_TO_KEEP + 1))")

if [ -z "$OLD_REVISIONS" ]; then
    echo "Nothing to clean up."
else
    for OLD_REVISION in $OLD_REVISIONS; do
        echo "Deleting old revision: $OLD_REVISION"
        gcloud run revisions delete "$OLD_REVISION" --region="$REGION" --quiet
    done
fi

echo

URL=$(gcloud run services describe "$SERVICE" \
    --region="$REGION" \
    --format="value(status.url)")

echo
echo "Application:"
echo "${URL}/app"
echo
