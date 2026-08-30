FROM nginx:alpine

COPY site/ /usr/share/nginx/html/
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/.htpasswd /etc/nginx/.htpasswd

EXPOSE 80
