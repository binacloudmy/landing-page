// Declarative pipeline: build the Astro site and rsync dist/ to the Apache web root.
// Server details are never hard-coded: set them as parameters (defaults below are placeholders).
pipeline {
  // Option A (default): Docker agent. Needs the Docker Pipeline plugin and docker on the node.
  agent {
    docker {
      image 'node:22'
      // npm writes its cache under $HOME; the container user has no writable home.
      args '-e HOME=/tmp/home'
    }
  }
  // Option B: a Jenkins node with the NodeJS plugin. Replace the agent block above with:
  //   agent any
  //   tools { nodejs 'node-22' }   // name configured in Manage Jenkins > Tools

  options {
    timestamps()
    disableConcurrentBuilds()
  }

  parameters {
    string(name: 'DEPLOY_HOST', defaultValue: 'CHANGE_ME_HOST', description: 'Web server hostname or IP')
    string(name: 'DEPLOY_USER', defaultValue: 'CHANGE_ME_USER', description: 'SSH user on the web server')
    string(name: 'DEPLOY_PATH', defaultValue: '/var/www/CHANGE_ME/', description: 'Apache web root (trailing slash)')
  }

  environment {
    DEPLOY_HOST = "${params.DEPLOY_HOST}"
    DEPLOY_USER = "${params.DEPLOY_USER}"
    DEPLOY_PATH = "${params.DEPLOY_PATH}"
    DEPLOY_CREDENTIALS_ID = 'bina-landing-deploy' // SSH private key credential in Jenkins
  }

  stages {
    stage('Install') {
      steps {
        sh 'npm ci'
      }
    }

    stage('Build') {
      steps {
        sh 'npm run build'
      }
    }

    stage('Deploy') {
      when { branch 'master' }
      steps {
        sshagent(credentials: [env.DEPLOY_CREDENTIALS_ID]) {
          // --delete removes stale files; .well-known (e.g. TLS challenges) is left alone.
          sh '''
            rsync -avz --delete --exclude '.well-known' \
              -e "ssh -o StrictHostKeyChecking=accept-new" \
              dist/ "$DEPLOY_USER@$DEPLOY_HOST:$DEPLOY_PATH"
          '''
        }
      }
    }
  }
}
